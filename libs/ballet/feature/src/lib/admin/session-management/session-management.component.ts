import { Component, ChangeDetectionStrategy, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  BalletStateService,
  AttendanceStatus,
  ClassSession,
  TicketPack,
  Course,
  CreateClassSessionParams
} from '@libs/ballet/data-access';
import { MultiDateCalendarComponent } from '@libs/shared/ui';

export interface PreviewSessionItem {
  sessionIndex: number;
  date: string;
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  venueName: string;
  venueCost: number;
  teacherFee: number;
  otherCost: number;
  feePerStudent: number;
  maxCapacity: number;
  minThreshold: number;
  enrolledCount: number;
}

@Component({
  selector: 'app-session-management',
  standalone: true,
  imports: [CommonModule, FormsModule, MultiDateCalendarComponent],
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

  // 刪除期班確認彈窗 Signals
  readonly showDeleteCourseModal = signal<boolean>(false);

  // 排定新課堂彈窗與表單 Signals
  readonly showCreateSessionModal = signal<boolean>(false);
  readonly newSessionCourseId = signal<string>('course-1');

  // 視覺化月曆選取開課日期 Signals (多日點選)
  readonly selectedDates = signal<string[]>([]);

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

  // 即時預覽排定課堂清單 (依據月曆所選日期自動推算)
  readonly previewSessions = computed<PreviewSessionItem[]>(() => {
    const courseId = this.newSessionCourseId();
    const existingSessions = this.allSessions().filter(s => s.courseId === courseId);
    const existingCount = existingSessions.length;
    const enrolledCount = this.state.courseEnrollments()
      .filter(e => e.courseId === courseId && e.status === 'active').length;

    const startTime = this.newSessionStartTime();
    const endTime = this.newSessionEndTime();
    const venueName = this.newSessionVenue();
    const venueCost = Number(this.newSessionVenueCost());
    const teacherFee = Number(this.newSessionTeacherFee());
    const otherCost = Number(this.newSessionOtherCost());
    const feePerStudent = Number(this.newSessionFeePerStudent());
    const maxCapacity = Number(this.newSessionMaxCapacity());
    const minThreshold = Number(this.newSessionMinThreshold());

    const dates = [...this.selectedDates()].sort((a, b) => a.localeCompare(b));

    return dates.map((dateStr, i) => ({
      sessionIndex: existingCount + i + 1,
      date: dateStr,
      dayOfWeek: this.getDayOfWeekString(dateStr),
      startTime,
      endTime,
      venueName,
      venueCost,
      teacherFee,
      otherCost,
      feePerStudent,
      maxCapacity,
      minThreshold,
      enrolledCount
    }));
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

  // 尚未加入當前期班名冊的學員 (以期班為核心綁定)
  readonly availableStudentsToEnroll = computed(() => {
    const currentCourse = this.currentCourse();
    if (!currentCourse) {
      const currentEnrolledStudentIds = new Set(this.attendanceList().map(item => item.student.id));
      return this.studentsWithPacks().filter(stu => !currentEnrolledStudentIds.has(stu.id));
    }
    const enrolledIds = new Set(
      this.state.courseEnrollments()
        .filter(ce => ce.courseId === currentCourse.id && ce.status === 'active')
        .map(ce => ce.studentId)
    );
    return this.studentsWithPacks().filter(stu => !enrolledIds.has(stu.id));
  });

  // 既有學員批次多選與搜尋 Signals
  readonly selectedStudentIdsToEnroll = signal<string[]>([]);
  readonly existingSearchQuery = signal<string>('');

  readonly filteredAvailableStudents = computed(() => {
    const query = this.existingSearchQuery().trim().toLowerCase();
    const students = this.availableStudentsToEnroll();
    if (!query) return students;

    const queryDigits = query.replace(/\D/g, '');
    return students.filter(student => {
      const matchName = student.name.toLowerCase().includes(query);
      const studentPhoneDigits = student.phone.replace(/\D/g, '');
      const matchPhone = student.phone.toLowerCase().includes(query) ||
        (queryDigits.length > 0 && studentPhoneDigits.includes(queryDigits));
      return matchName || matchPhone;
    });
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
    alert(`已成功建立期班課程【${createdCourse.title}】！`);
  }

  openDeleteCourseModal(): void {
    if (this.currentCourse()) {
      this.showDeleteCourseModal.set(true);
    }
  }

  closeDeleteCourseModal(): void {
    this.showDeleteCourseModal.set(false);
  }

  confirmDeleteCourse(): void {
    const curr = this.currentCourse();
    if (!curr) return;
    this.state.deleteCourse(curr.id);
    this.closeDeleteCourseModal();
  }

  // 開啟排定新課堂彈窗
  openCreateSessionModal(): void {
    this.createSessionError.set(null);
    const currCourse = this.state.currentCourse();
    const courseId = currCourse ? currCourse.id : (this.courses()[0]?.id || 'course-1');

    this.newSessionCourseId.set(courseId);
    this.selectedDates.set([]);

    this.newSessionStartTime.set('14:00');
    this.newSessionEndTime.set('15:30');
    this.newSessionVenue.set('敦南日光舞蹈排練室 A 廳');
    const course = this.courses().find(c => c.id === courseId) || currCourse;
    this.applyCourseDefaults(course);
    this.showCreateSessionModal.set(true);
  }

  // 排定課堂彈窗中切換所屬課程連動預設值
  onCourseSelectInCreateSession(courseId: string): void {
    this.newSessionCourseId.set(courseId);
    const course = this.courses().find(c => c.id === courseId);
    if (course) {
      this.applyCourseDefaults(course);
    }
  }

  private applyCourseDefaults(course?: Course): void {
    if (!course) return;
    this.newSessionVenueCost.set(course.defaultVenueCost ?? 2000);
    this.newSessionTeacherFee.set(course.defaultTeacherFee ?? 1200);
    this.newSessionFeePerStudent.set(course.defaultFeePerStudent ?? 500);
    this.newSessionMinThreshold.set(course.minThreshold ?? 4);
  }

  onSelectedDatesChange(dates: string[]): void {
    this.selectedDates.set(dates);
  }

  removeSelectedDate(dateToRemove: string): void {
    this.selectedDates.set(this.selectedDates().filter(d => d !== dateToRemove));
  }

  clearSelectedDates(): void {
    this.selectedDates.set([]);
  }

  // 關閉排定新課堂彈窗
  closeCreateSessionModal(): void {
    this.showCreateSessionModal.set(false);
    this.createSessionError.set(null);
  }

  // 提交排定新課堂
  submitCreateSession(): void {
    const courseId = this.newSessionCourseId();
    const startTime = this.newSessionStartTime().trim();
    const endTime = this.newSessionEndTime().trim();
    const venueName = this.newSessionVenue().trim();
    const venueCost = Number(this.newSessionVenueCost());
    const teacherFee = Number(this.newSessionTeacherFee());
    const otherCost = Number(this.newSessionOtherCost());
    const feePerStudent = Number(this.newSessionFeePerStudent());
    const maxCapacity = Number(this.newSessionMaxCapacity());
    const minThreshold = Number(this.newSessionMinThreshold());

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

    const previews = this.previewSessions();
    if (previews.length === 0) {
      this.createSessionError.set('請於月曆中至少點選選取一個開課日期');
      return;
    }

    if (previews.length === 1) {
      const p = previews[0];
      const created = this.state.createSession({
        courseId,
        date: p.date,
        dayOfWeek: p.dayOfWeek,
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
      alert(`已成功排定【${created.title}】（${created.date} ${created.dayOfWeek}）！`);
    } else {
      const sessionsToCreate: CreateClassSessionParams[] = previews.map(p => ({
        courseId,
        date: p.date,
        dayOfWeek: p.dayOfWeek,
        startTime,
        endTime,
        venueName,
        venueCost,
        teacherFee,
        otherCost,
        feePerStudent,
        maxCapacity,
        minThreshold
      }));
      const created = this.state.createSessionsBatch(sessionsToCreate);
      this.closeCreateSessionModal();
      alert(`已成功批次排定 ${created.length} 堂課！名冊學員已全數自動登錄。`);
    }
  }

  getDayOfWeekString(dateStr: string): string {
    if (!dateStr) return '';
    const days = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
    const parts = dateStr.split('-');
    if (parts.length < 3) return '';
    const y = Number(parts[0]);
    const m = Number(parts[1]);
    const d = Number(parts[2]);
    const dateObj = new Date(y, m - 1, d);
    return !isNaN(dateObj.getDay()) ? days[dateObj.getDay()] : '';
  }

  formatDate(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  // 開班門檻不足時一鍵取消順延
  handleCancelSession(): void {
    const s = this.session();
    if (!s) return;
    if (
      confirm(
        `確定要順延此課堂嗎？\n\n系統將自動取消本週課堂，並全數退還學員已扣除之堂數，保障教室場租不虧本。`
      )
    ) {
      this.state.cancelSessionDueToThreshold(s.id);
      alert('已成功取消並順延本週課堂，學員堂數均已保全！');
    }
  }

  // 手動變更出勤狀態
  changeAttendance(studentId: string, status: AttendanceStatus): void {
    if (!this.session()) return;
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
    if (!this.currentCourse() && !this.session()) {
      alert('請先選擇期班或排定課堂，再為名冊加入學員。');
      return;
    }
    this.enrollError.set(null);
    this.selectedStudentIdsToEnroll.set([]);
    this.existingSearchQuery.set('');
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
    this.selectedStudentIdsToEnroll.set([]);
    this.existingSearchQuery.set('');
    this.enrollError.set(null);
  }

  toggleStudentSelection(studentId: string): void {
    const current = this.selectedStudentIdsToEnroll();
    if (current.includes(studentId)) {
      this.selectedStudentIdsToEnroll.set(current.filter(id => id !== studentId));
    } else {
      this.selectedStudentIdsToEnroll.set([...current, studentId]);
    }
  }

  selectAllAvailableStudents(): void {
    const availableIds = this.filteredAvailableStudents().map(s => s.id);
    const currentSet = new Set(this.selectedStudentIdsToEnroll());
    availableIds.forEach(id => currentSet.add(id));
    this.selectedStudentIdsToEnroll.set(Array.from(currentSet));
  }

  clearSelectedStudents(): void {
    this.selectedStudentIdsToEnroll.set([]);
  }

  submitBatchEnrollStudents(): void {
    const course = this.currentCourse();
    const curr = this.session();
    const courseId = course?.id || curr?.courseId;

    if (this.selectedStudentIdsToEnroll().length === 0) {
      this.enrollError.set('請至少選取一位學員');
      return;
    }

    if (!courseId) {
      this.enrollError.set('未指定期班課程');
      return;
    }

    this.state.enrollStudentsBatchInCourse(courseId, this.selectedStudentIdsToEnroll());
    this.closeEnrollModal();
  }

  submitEnrollStudent(): void {
    const studentId = this.selectedStudentToEnroll();
    const course = this.currentCourse();
    const curr = this.session();
    const courseId = course?.id || curr?.courseId;

    if (!studentId) {
      this.enrollError.set('請選擇要加入的學員');
      return;
    }

    if (courseId) {
      const enr = this.state.enrollStudentInCourse(courseId, studentId);
      if (enr) {
        this.closeEnrollModal();
        return;
      }
    } else if (curr) {
      const rec = this.state.enrollStudentInSession(curr.id, studentId);
      if (rec) {
        this.closeEnrollModal();
        return;
      }
    }

    this.enrollError.set('加入期班名冊失敗');
  }

  submitQuickCreateAndEnroll(): void {
    const course = this.currentCourse();
    const curr = this.session();
    const courseId = course?.id || curr?.courseId;

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

    const phoneDigits = phone.replace(/\D/g, '');
    const existing = this.state.students().find(s => {
      const sDigits = s.phone.replace(/\D/g, '');
      return (phoneDigits.length >= 8 && sDigits === phoneDigits) || s.phone === phone;
    });
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

    if (newStudent) {
      if (courseId) {
        this.state.enrollStudentInCourse(courseId, newStudent.id);
      } else if (curr) {
        this.state.enrollStudentInSession(curr.id, newStudent.id);
      }
    }

    this.closeEnrollModal();
  }

  handleRemoveFromCourse(studentId: string, studentName: string): void {
    const course = this.currentCourse();
    const curr = this.session();
    const courseId = course?.id || curr?.courseId;
    if (!courseId) {
      if (curr) {
        this.handleRemoveFromSession(studentId, studentName);
      }
      return;
    }

    const courseTitle = course?.title || '當前期班';
    if (confirm(`確定要將學員【${studentName}】自期班【${courseTitle}】名冊中移出嗎？\n（未上課之待簽到堂數將自名冊移出，已完成之歷史出席與扣堂記錄將安全保留）`)) {
      this.state.removeStudentFromCourse(courseId, studentId);
    }
  }

  handleRemoveFromSession(studentId: string, studentName: string): void {
    const curr = this.session();
    if (!curr) return;

    if (curr.courseId) {
      this.handleRemoveFromCourse(studentId, studentName);
      return;
    }

    if (confirm(`確定要將學員【${studentName}】自本堂課名冊中移出嗎？`)) {
      this.state.removeStudentFromSession(curr.id, studentId);
    }
  }
}
