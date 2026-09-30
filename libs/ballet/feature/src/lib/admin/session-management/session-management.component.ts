import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  BalletStateService,
  AttendanceStatus,
  ClassSession,
  TicketPack
} from '@libs/ballet/data-access';

@Component({
  selector: 'app-session-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './session-management.component.html',
  styleUrls: ['./session-management.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SessionManagementComponent {
  readonly Math = Math;
  readonly state = inject(BalletStateService);

  readonly session = this.state.currentSession;
  readonly financials = this.state.currentSessionFinancials;
  readonly attendanceList = this.state.currentSessionAttendance;
  readonly studentsWithPacks = this.state.studentsWithPacks;
  readonly allSessions = this.state.sessions;

  // 建立新課堂彈窗與表單 Signals
  readonly showCreateModal = signal<boolean>(false);
  readonly newSessionTitle = signal<string>('成人優雅芭蕾美姿體雕班');
  readonly newSessionDate = signal<string>('');
  readonly newSessionStartTime = signal<string>('14:00');
  readonly newSessionEndTime = signal<string>('15:30');
  readonly newSessionVenue = signal<string>('敦南日光舞蹈排練室 A 廳');
  readonly newSessionVenueCost = signal<number>(2000);
  readonly newSessionFeePerStudent = signal<number>(500);
  readonly newSessionMaxCapacity = signal<number>(10);
  readonly newSessionMinThreshold = signal<number>(4);
  readonly createFormError = signal<string | null>(null);

  // 根據日期自動推算星期幾
  readonly newSessionDayOfWeek = computed(() => {
    const dateStr = this.newSessionDate();
    if (!dateStr) return '';
    const days = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
    const d = new Date(`${dateStr}T00:00:00`);
    return !isNaN(d.getDay()) ? days[d.getDay()] : '';
  });

  // 簽名放大查看彈窗
  readonly viewingSignature = signal<{
    name: string;
    time: string;
    imgUrl: string;
  } | null>(null);

  // 手動加入學員至當前課堂彈窗 Signals
  readonly showEnrollModal = signal<boolean>(false);
  readonly selectedStudentToEnroll = signal<string>('');
  readonly enrollError = signal<string | null>(null);
  readonly enrollMode = signal<'existing' | 'new'>('existing');
  readonly newQuickStudentName = signal<string>('');
  readonly newQuickStudentPhone = signal<string>('');
  readonly newQuickStudentNotes = signal<string>('');
  readonly newQuickStudentPackType = signal<'none' | '5_class' | '10_class' | 'trial'>('10_class');

  // 尚未加入當前課堂名冊的學員
  readonly availableStudentsToEnroll = computed(() => {
    const currentEnrolledStudentIds = new Set(this.attendanceList().map(item => item.student.id));
    return this.studentsWithPacks().filter(stu => !currentEnrolledStudentIds.has(stu.id));
  });

  // 切換選取的課堂
  handleSelectSession(sessionId: string): void {
    this.state.setSelectedSession(sessionId);
  }

  // 開啟建立新課堂彈窗
  openCreateModal(): void {
    this.createFormError.set(null);
    this.newSessionTitle.set('成人優雅芭蕾美姿體雕班');
    this.newSessionDate.set(this.getNextSaturdayDate());
    this.newSessionStartTime.set('14:00');
    this.newSessionEndTime.set('15:30');
    this.newSessionVenue.set('敦南日光舞蹈排練室 A 廳');
    this.newSessionVenueCost.set(2000);
    this.newSessionFeePerStudent.set(500);
    this.newSessionMaxCapacity.set(10);
    this.newSessionMinThreshold.set(4);
    this.showCreateModal.set(true);
  }

  // 關閉建立新課堂彈窗
  closeCreateModal(): void {
    this.showCreateModal.set(false);
    this.createFormError.set(null);
  }

  // 提交建立新課堂
  submitCreateSession(): void {
    const title = this.newSessionTitle().trim();
    const date = this.newSessionDate().trim();
    const startTime = this.newSessionStartTime().trim();
    const endTime = this.newSessionEndTime().trim();
    const venueName = this.newSessionVenue().trim();
    const venueCost = Number(this.newSessionVenueCost());
    const feePerStudent = Number(this.newSessionFeePerStudent());
    const maxCapacity = Number(this.newSessionMaxCapacity());
    const minThreshold = Number(this.newSessionMinThreshold());

    if (!title) {
      this.createFormError.set('請填寫課程名稱');
      return;
    }
    if (!date) {
      this.createFormError.set('請選擇開課日期');
      return;
    }
    if (!startTime || !endTime) {
      this.createFormError.set('請填寫完整上課時段');
      return;
    }
    if (startTime >= endTime) {
      this.createFormError.set('下課時間必須晚於開課時間');
      return;
    }
    if (!venueName) {
      this.createFormError.set('請填寫上課教室地點');
      return;
    }
    if (venueCost <= 0 || feePerStudent <= 0 || maxCapacity <= 0 || minThreshold <= 0) {
      this.createFormError.set('場租、學費與人數設定必須大於 0');
      return;
    }
    if (minThreshold > maxCapacity) {
      this.createFormError.set('開班門檻人數不能大於滿額人數');
      return;
    }

    const created = this.state.createSession({
      title,
      date,
      dayOfWeek: this.newSessionDayOfWeek(),
      startTime,
      endTime,
      venueName,
      venueCost,
      feePerStudent,
      maxCapacity,
      minThreshold
    });

    this.closeCreateModal();
    alert(`✅ 已成功建立【${created.title}】（${created.date} ${created.dayOfWeek}）！`);
  }

  private getNextSaturdayDate(): string {
    const today = new Date();
    const day = today.getDay();
    const diff = (6 - day + 7) % 7 || 7;
    const nextSat = new Date(today);
    nextSat.setDate(today.getDate() + diff);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${nextSat.getFullYear()}-${pad(nextSat.getMonth() + 1)}-${pad(nextSat.getDate())}`;
  }

  // 開班門檻不足時一鍵取消順延
  handleCancelSession(): void {
    const s = this.session();
    if (!s) return;
    if (
      confirm(
        `⚠️ 確定要順延此課堂嗎？\n\n系統將自動取消本週課堂，並全數退還學員已扣除之堂數，保障教室場租不虧本。`
      )
    ) {
      this.state.cancelSessionDueToThreshold(s.id);
      alert('已成功取消並順延本週課堂，學員堂數均已保全！');
    }
  }

  // 手動變更出勤狀態
  changeAttendance(studentId: string, status: AttendanceStatus): void {
    this.state.setStudentAttendanceStatus(studentId, status);
  }

  // 檢視放大簽名
  openSignatureModal(name: string, time: string, imgUrl?: string): void {
    if (!imgUrl) return;
    this.viewingSignature.set({ name, time, imgUrl });
  }

  closeSignatureModal(): void {
    this.viewingSignature.set(null);
  }

  openEnrollModal(): void {
    this.enrollError.set(null);
    const available = this.availableStudentsToEnroll();
    this.selectedStudentToEnroll.set(available.length > 0 ? available[0].id : '');
    this.enrollMode.set(available.length > 0 ? 'existing' : 'new');
    this.newQuickStudentName.set('');
    this.newQuickStudentPhone.set('');
    this.newQuickStudentNotes.set('');
    this.newQuickStudentPackType.set('10_class');
    this.showEnrollModal.set(true);
  }

  closeEnrollModal(): void {
    this.showEnrollModal.set(false);
    this.enrollError.set(null);
  }

  submitEnrollStudent(): void {
    const studentId = this.selectedStudentToEnroll();
    const curr = this.session();
    if (!curr) {
      this.enrollError.set('請先選擇課堂');
      return;
    }
    if (!studentId) {
      this.enrollError.set('請選擇要加入的學員');
      return;
    }

    const rec = this.state.enrollStudentInSession(curr.id, studentId);
    if (rec) {
      this.closeEnrollModal();
    } else {
      this.enrollError.set('加入課堂名冊失敗');
    }
  }

  submitQuickCreateAndEnroll(): void {
    const curr = this.session();
    if (!curr) {
      this.enrollError.set('請先選擇課堂');
      return;
    }

    const name = this.newQuickStudentName().trim();
    const phone = this.newQuickStudentPhone().trim();
    const notes = this.newQuickStudentNotes().trim();
    const packType = this.newQuickStudentPackType();

    if (!name) {
      this.enrollError.set('請輸入學員姓名');
      return;
    }
    if (!phone) {
      this.enrollError.set('請輸入聯絡電話');
      return;
    }

    const existing = this.state.students().find(s => s.phone === phone);
    if (existing) {
      this.enrollError.set(`此電話已被學員【${existing.name}】使用`);
      return;
    }

    const newStudent = this.state.addStudent({
      name,
      phone,
      notes: notes || undefined,
      initialPackType: packType
    });

    this.state.enrollStudentInSession(curr.id, newStudent.id);
    this.closeEnrollModal();
  }

  handleRemoveFromSession(studentId: string, studentName: string): void {
    const curr = this.session();
    if (!curr) return;

    if (confirm(`確定要將學員【${studentName}】自本堂課名冊中移出嗎？`)) {
      this.state.removeStudentFromSession(curr.id, studentId);
    }
  }
}
