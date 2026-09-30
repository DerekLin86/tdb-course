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

  readonly courses = this.state.courses;
  readonly currentCourse = this.state.currentCourse;
  readonly courseFinancials = this.state.currentCourseFinancials;
  readonly courseSessions = this.state.currentCourseSessions;
  readonly session = this.state.currentSession;
  readonly financials = this.state.currentSessionFinancials;
  readonly attendanceList = this.state.currentSessionAttendance;
  readonly studentsWithPacks = this.state.studentsWithPacks;
  readonly allSessions = this.state.sessions;

  // 建立新期班彈窗與表單 Signals
  readonly showCreateCourseModal = signal<boolean>(false);
  readonly newCourseTitle = signal<string>('');
  readonly newCourseDescription = signal<string>('');
  readonly newCourseTotalSessions = signal<number>(8);
  readonly newCourseDefaultVenueCost = signal<number>(2000);
  readonly newCourseDefaultTeacherFee = signal<number>(1200);
  readonly newCourseDefaultFeePerStudent = signal<number>(500);
  readonly newCourseMinThreshold = signal<number>(4);
  readonly createCourseError = signal<string | null>(null);

  // 排定新課堂彈窗與表單 Signals
  readonly showCreateSessionModal = signal<boolean>(false);
  readonly newSessionCourseId = signal<string>('course-1');
  readonly newSessionDate = signal<string>('');
  readonly newSessionStartTime = signal<string>('14:00');
  readonly newSessionEndTime = signal<string>('15:30');
  readonly newSessionVenue = signal<string>('敦南日光舞蹈排練室 A 廳');
  readonly newSessionVenueCost = signal<number>(2000);
  readonly newSessionTeacherFee = signal<number>(1200);
  readonly newSessionOtherCost = signal<number>(0);
  readonly newSessionFeePerStudent = signal<number>(500);
  readonly newSessionMaxCapacity = signal<number>(10);
  readonly newSessionMinThreshold = signal<number>(4);
  readonly createSessionError = signal<string | null>(null);

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

  // 切換選取的期班課程
  handleSelectCourse(courseId: string): void {
    this.state.setSelectedCourse(courseId);
  }

  // 切換選取的課堂
  handleSelectSession(sessionId: string): void {
    this.state.setSelectedSession(sessionId);
  }

  // 開啟建立新期班彈窗
  openCreateCourseModal(): void {
    this.createCourseError.set(null);
    this.newCourseTitle.set('');
    this.newCourseDescription.set('');
    this.newCourseTotalSessions.set(8);
    this.newCourseDefaultVenueCost.set(2000);
    this.newCourseDefaultTeacherFee.set(1200);
    this.newCourseDefaultFeePerStudent.set(500);
    this.newCourseMinThreshold.set(4);
    this.showCreateCourseModal.set(true);
  }

  // 關閉建立新期班彈窗
  closeCreateCourseModal(): void {
    this.showCreateCourseModal.set(false);
    this.createCourseError.set(null);
  }

  // 提交建立新期班課程
  submitCreateCourse(): void {
    const title = this.newCourseTitle().trim();
    const description = this.newCourseDescription().trim();
    const totalSessions = Number(this.newCourseTotalSessions());
    const defaultVenueCost = Number(this.newCourseDefaultVenueCost());
    const defaultTeacherFee = Number(this.newCourseDefaultTeacherFee());
    const defaultFeePerStudent = Number(this.newCourseDefaultFeePerStudent());
    const minThreshold = Number(this.newCourseMinThreshold());

    if (!title) {
      this.createCourseError.set('請填寫期班課程名稱');
      return;
    }
    if (!totalSessions || totalSessions <= 0) {
      this.createCourseError.set('全期總堂數必須大於 0');
      return;
    }
    if (defaultVenueCost < 0 || defaultTeacherFee < 0 || defaultFeePerStudent <= 0 || minThreshold <= 0) {
      this.createCourseError.set('預設成本與學費不可為負數，開班門檻與學費必須大於 0');
      return;
    }

    const createdCourse = this.state.createCourse({
      title,
      description,
      totalSessions,
      defaultVenueCost,
      defaultTeacherFee,
      defaultFeePerStudent,
      minThreshold
    });

    this.closeCreateCourseModal();
    alert(`✅ 已成功建立期班課程【${createdCourse.title}】！`);
  }

  // 開啟排定新課堂彈窗
  openCreateSessionModal(): void {
    this.createSessionError.set(null);
    const currCourse = this.state.currentCourse();
    const courseId = currCourse ? currCourse.id : (this.courses()[0]?.id || 'course-1');

    this.newSessionCourseId.set(courseId);
    this.newSessionDate.set(this.getNextSaturdayDate());
    this.newSessionStartTime.set('14:00');
    this.newSessionEndTime.set('15:30');
    this.newSessionVenue.set('敦南日光舞蹈排練室 A 廳');
    this.newSessionVenueCost.set(currCourse?.defaultVenueCost ?? 2000);
    this.newSessionTeacherFee.set(currCourse?.defaultTeacherFee ?? 1200);
    this.newSessionOtherCost.set(0);
    this.newSessionFeePerStudent.set(currCourse?.defaultFeePerStudent ?? 500);
    this.newSessionMaxCapacity.set(10);
    this.newSessionMinThreshold.set(currCourse?.minThreshold ?? 4);
    this.showCreateSessionModal.set(true);
  }

  // 排定課堂彈窗中切換所屬課程連動預設值
  onCourseSelectInCreateSession(courseId: string): void {
    this.newSessionCourseId.set(courseId);
    const course = this.courses().find(c => c.id === courseId);
    if (course) {
      this.newSessionVenueCost.set(course.defaultVenueCost);
      this.newSessionTeacherFee.set(course.defaultTeacherFee);
      this.newSessionFeePerStudent.set(course.defaultFeePerStudent);
      this.newSessionMinThreshold.set(course.minThreshold);
    }
  }

  // 關閉排定新課堂彈窗
  closeCreateSessionModal(): void {
    this.showCreateSessionModal.set(false);
    this.createSessionError.set(null);
  }

  // 提交排定新課堂
  submitCreateSession(): void {
    const courseId = this.newSessionCourseId();
    const date = this.newSessionDate().trim();
    const startTime = this.newSessionStartTime().trim();
    const endTime = this.newSessionEndTime().trim();
    const venueName = this.newSessionVenue().trim();
    const venueCost = Number(this.newSessionVenueCost());
    const teacherFee = Number(this.newSessionTeacherFee());
    const otherCost = Number(this.newSessionOtherCost());
    const feePerStudent = Number(this.newSessionFeePerStudent());
    const maxCapacity = Number(this.newSessionMaxCapacity());
    const minThreshold = Number(this.newSessionMinThreshold());

    if (!date) {
      this.createSessionError.set('請選擇開課日期');
      return;
    }
    if (!startTime || !endTime) {
      this.createSessionError.set('請填寫完整上課時段');
      return;
    }
    if (startTime >= endTime) {
      this.createSessionError.set('下課時間必須晚於開課時間');
      return;
    }
    if (!venueName) {
      this.createSessionError.set('請填寫上課教室地點');
      return;
    }
    if (venueCost <= 0 || feePerStudent <= 0 || maxCapacity <= 0 || minThreshold <= 0 || teacherFee < 0 || otherCost < 0) {
      this.createSessionError.set('成本與學費設定不可為負數，場租與學費必須大於 0');
      return;
    }
    if (minThreshold > maxCapacity) {
      this.createSessionError.set('開班門檻人數不能大於滿額人數');
      return;
    }

    const created = this.state.createSession({
      courseId,
      date,
      dayOfWeek: this.newSessionDayOfWeek(),
      startTime,
      endTime,
      venueName,
      venueCost,
      teacherFee,
      otherCost,
      feePerStudent,
      maxCapacity,
      minThreshold
    });

    this.closeCreateSessionModal();
    alert(`✅ 已成功排定【${created.title}】（${created.date} ${created.dayOfWeek}）！`);
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
