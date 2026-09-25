import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BalletStateService, AttendanceStatus, StudentWithActivePack, ClassSession, TicketPack, StudentAttendanceHistoryItem } from '@libs/ballet/data-access';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-dashboard.component.html',
  styleUrls: ['./admin-dashboard.component.scss']
})
export class AdminDashboardComponent {
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

  // 標籤頁切換
  readonly activeTab = signal<'attendance' | 'tickets' | 'students'>('attendance');

  // 學員檔案與歷程 Signals
  readonly selectedStudentIdForHistory = signal<string>('');
  readonly studentSearchKeyword = signal<string>('');
  readonly editingDetailNotes = signal<string>('');
  readonly notesSaveMessage = signal<string | null>(null);

  // 模糊過濾學員清單
  readonly filteredStudentsForHistory = computed(() => {
    const list = this.studentsWithPacks();
    const kw = this.studentSearchKeyword().trim().toLowerCase();
    if (!kw) return list;
    return list.filter(s =>
      s.name.toLowerCase().includes(kw) ||
      s.phone.includes(kw) ||
      (s.notes && s.notes.toLowerCase().includes(kw))
    );
  });

  // 當前選取查看的學員檔案（若未手動選取則預設選取過濾清單或全體學員的第一位）
  readonly selectedStudentForHistory = computed<StudentWithActivePack | null>(() => {
    const id = this.selectedStudentIdForHistory();
    const filtered = this.filteredStudentsForHistory();
    const all = this.studentsWithPacks();

    if (id) {
      const found = all.find(s => s.id === id);
      if (found) return found;
    }

    if (filtered.length > 0) return filtered[0];
    if (all.length > 0) return all[0];
    return null;
  });

  // 當前選取學員的完整上課歷程（依時間降冪）
  readonly selectedStudentAttendanceHistory = computed<StudentAttendanceHistoryItem[]>(() => {
    const stu = this.selectedStudentForHistory();
    if (!stu) return [];
    return this.state.getStudentAttendanceHistory(stu.id);
  });

  // 當前選取學員的所有票卡歷史（依購買日期降冪）
  readonly selectedStudentPacksHistory = computed<TicketPack[]>(() => {
    const stu = this.selectedStudentForHistory();
    if (!stu) return [];
    return this.state.getStudentTicketPacks(stu.id);
  });

  // 當前選取學員的出席與票卡統計
  readonly selectedStudentStats = computed(() => {
    const history = this.selectedStudentAttendanceHistory();
    const stu = this.selectedStudentForHistory();
    let attended = 0;
    let advanceLeave = 0;
    let lateLeave = 0;
    let absent = 0;

    for (const item of history) {
      switch (item.record.status) {
        case 'attended':
          attended++;
          break;
        case 'leave_advance':
          advanceLeave++;
          break;
        case 'leave_late':
          lateLeave++;
          break;
        case 'absent':
          absent++;
          break;
      }
    }

    return {
      totalAttended: attended,
      totalAdvanceLeave: advanceLeave,
      totalLateLeave: lateLeave,
      totalAbsent: absent,
      totalSessionsEnrolled: history.length,
      remainingCount: stu?.activePack?.remainingCount ?? 0,
      activePackType: stu?.activePack?.type,
      activePackExpiry: stu?.activePack?.expiryDate
    };
  });

  constructor() {
    // 監聽選取學員變動，同步載入該學員最新備註
    effect(() => {
      const stu = this.selectedStudentForHistory();
      this.editingDetailNotes.set(stu?.notes || '');
      this.notesSaveMessage.set(null);
    }, { allowSignalWrites: true });
  }

  // 新增學員彈窗 Signals
  readonly showAddStudentModal = signal<boolean>(false);
  readonly newStudentName = signal<string>('');
  readonly newStudentPhone = signal<string>('');
  readonly newStudentNotes = signal<string>('');
  readonly newStudentPackType = signal<'none' | '5_class' | '10_class' | 'trial'>('10_class');
  readonly addStudentError = signal<string | null>(null);

  // 編輯學員彈窗 Signals
  readonly showEditStudentModal = signal<boolean>(false);
  readonly editingStudentId = signal<string | null>(null);
  readonly editStudentName = signal<string>('');
  readonly editStudentPhone = signal<string>('');
  readonly editStudentNotes = signal<string>('');
  readonly editStudentError = signal<string | null>(null);

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

  // 開啟新增學員彈窗
  openAddStudentModal(): void {
    this.addStudentError.set(null);
    this.newStudentName.set('');
    this.newStudentPhone.set('');
    this.newStudentNotes.set('');
    this.newStudentPackType.set('10_class');
    this.showAddStudentModal.set(true);
  }

  closeAddStudentModal(): void {
    this.showAddStudentModal.set(false);
    this.addStudentError.set(null);
  }

  submitAddStudent(): void {
    const name = this.newStudentName().trim();
    const phone = this.newStudentPhone().trim();
    const notes = this.newStudentNotes().trim();
    const packType = this.newStudentPackType();

    if (!name) {
      this.addStudentError.set('請輸入學員姓名');
      return;
    }
    if (!phone) {
      this.addStudentError.set('請輸入聯絡電話');
      return;
    }

    // 檢查電話是否已被註冊
    const existing = this.state.students().find(s => s.phone === phone);
    if (existing) {
      this.addStudentError.set(`此電話已被學員【${existing.name}】使用`);
      return;
    }

    const created = this.state.addStudent({
      name,
      phone,
      notes: notes || undefined,
      initialPackType: packType
    });

    this.closeAddStudentModal();
    alert(`✅ 已成功新增學員【${created.name}】！`);
  }

  // 開啟編輯學員彈窗
  openEditStudentModal(student: StudentWithActivePack): void {
    this.editStudentError.set(null);
    this.editingStudentId.set(student.id);
    this.editStudentName.set(student.name);
    this.editStudentPhone.set(student.phone);
    this.editStudentNotes.set(student.notes || '');
    this.showEditStudentModal.set(true);
  }

  closeEditStudentModal(): void {
    this.showEditStudentModal.set(false);
    this.editingStudentId.set(null);
    this.editStudentError.set(null);
  }

  submitEditStudent(): void {
    const studentId = this.editingStudentId();
    if (!studentId) return;

    const name = this.editStudentName().trim();
    const phone = this.editStudentPhone().trim();
    const notes = this.editStudentNotes().trim();

    if (!name) {
      this.editStudentError.set('學員姓名不能為空');
      return;
    }
    if (!phone) {
      this.editStudentError.set('聯絡電話不能為空');
      return;
    }

    // 檢查電話是否與其他學員衝突
    const conflict = this.state.students().find(s => s.phone === phone && s.id !== studentId);
    if (conflict) {
      this.editStudentError.set(`電話號碼已被其他學員【${conflict.name}】使用`);
      return;
    }

    this.state.updateStudent(studentId, {
      name,
      phone,
      notes: notes || undefined
    });

    this.closeEditStudentModal();
    alert(`✅ 已更新學員【${name}】的資料！`);
  }

  // 刪除 / 減少學員
  handleDeleteStudent(student: StudentWithActivePack): void {
    if (
      confirm(
        `⚠️ 確定要從班級名單中移除【${student.name}】嗎？\n\n該學員的所有票卡與出勤預約記錄亦將同步清除。`
      )
    ) {
      this.state.deleteStudent(student.id);
      alert(`已成功將【${student.name}】自班級名單中移除。`);
    }
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

  // 儲值票卡
  handleAddPack(student: StudentWithActivePack, type: '5_class' | '10_class' | 'trial'): void {
    if (type === 'trial') {
      if (this.state.hasPurchasedTrial(student.id)) {
        alert(`【${student.name}】已曾購買過體驗課，每位學員終身限購 1 次！請選購 5 堂或 10 堂常規方案。`);
        return;
      }
      if (confirm(`確定為【${student.name}】儲值 1 堂體驗課（優惠價 NT$ 400，效期 14 天）嗎？每位學員終身限購 1 次。`)) {
        const res = this.state.addTicketPack(student.id, 'trial', 1, 14, 400);
        alert(res.message);
      }
      return;
    }

    const count = type === '5_class' ? 5 : 10;
    const days = type === '5_class' ? 60 : 100;
    if (confirm(`確定為【${student.name}】儲值 ${count} 堂課票卡（效期 ${days} 天）嗎？`)) {
      const res = this.state.addTicketPack(student.id, type, count, days);
      alert(res.message);
    }
  }

  // 展延票卡效期
  handleExtendExpiry(student: StudentWithActivePack): void {
    if (!student.activePack) {
      alert('該學員目前沒有有效票卡');
      return;
    }
    if (confirm(`確定為【${student.name}】的票卡展延 30 天效期嗎？`)) {
      this.state.extendPackExpiry(student.activePack.id, 30);
      alert(`✅ 已為 ${student.name} 展延效期 30 天！`);
    }
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

  // 切換選取的學員檢視
  selectStudentForHistory(studentId: string): void {
    this.selectedStudentIdForHistory.set(studentId);
    const stu = this.studentsWithPacks().find(s => s.id === studentId);
    this.editingDetailNotes.set(stu?.notes || '');
    this.notesSaveMessage.set(null);
  }

  // 儲存學員備註
  saveStudentNotes(): void {
    const stu = this.selectedStudentForHistory();
    if (!stu) return;

    this.state.updateStudentNotes(stu.id, this.editingDetailNotes());
    this.notesSaveMessage.set('✅ 備註已成功儲存！');
    setTimeout(() => {
      this.notesSaveMessage.set(null);
    }, 2500);
  }
}
