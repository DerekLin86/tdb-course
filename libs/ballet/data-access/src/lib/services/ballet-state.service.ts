import { Injectable, signal, computed, effect, inject } from '@angular/core';
import { forkJoin, of, catchError } from 'rxjs';
import { Student, TicketPack, StudentWithActivePack, TicketPackType, CreateStudentParams, UpdateStudentParams } from '../types/student.type';
import {
  AttendanceRecord,
  AttendanceStatus,
  ClassSession,
  CreateClassSessionParams,
  SessionFinancialStats,
  StudentAttendanceHistoryItem,
  Course,
  CourseFinancialStats,
  CreateCourseParams,
  StudentCourseProgress,
  StudentCourseSessionDetail
} from '../types/attendance.type';
import { BalletApiService } from './ballet-api.service';

const STORAGE_KEY = 'triple_d_ballet_state_v1';

@Injectable({
  providedIn: 'root'
})
export class BalletStateService {
  private readonly api = inject(BalletApiService, { optional: true });

  // 基礎 Signals
  readonly courses = signal<Course[]>([]);
  readonly students = signal<Student[]>([]);
  readonly ticketPacks = signal<TicketPack[]>([]);
  readonly sessions = signal<ClassSession[]>([]);
  readonly attendance = signal<AttendanceRecord[]>([]);

  // 遠端同步 Signals
  readonly isSyncing = signal<boolean>(false);
  readonly isOnline = signal<boolean>(true);
  readonly lastSyncError = signal<string | null>(null);

  // 當前選取狀態
  readonly selectedCourseId = signal<string>('course-1');
  readonly selectedSessionId = signal<string>('session-upcoming');
  readonly selectedStudentId = signal<string>('stu-1');

  // 測試輔助：模擬距離開課的小時數（預設 30 小時，方便切換驗證 24h 前後）
  readonly simulationHoursUntilClass = signal<number>(30);

  // 1. 當前課程 Computed
  readonly currentCourse = computed(() => {
    const id = this.selectedCourseId();
    return this.courses().find(c => c.id === id) || this.courses()[0];
  });

  // 2. 當前課程包含之課堂清單 Computed
  readonly currentCourseSessions = computed(() => {
    const course = this.currentCourse();
    if (!course) return [];
    return this.sessions()
      .filter(s => s.courseId === course.id)
      .sort((a, b) => (a.sessionIndex ?? 0) - (b.sessionIndex ?? 0) || a.date.localeCompare(b.date));
  });

  // 3. 全期課程總體財務與營運統計 Computed
  readonly currentCourseFinancials = computed<CourseFinancialStats>(() => {
    const course = this.currentCourse();
    const sessions = this.currentCourseSessions();

    if (!course) {
      return {
        courseId: '',
        courseTitle: '',
        totalSessions: 0,
        completedSessions: 0,
        scheduledSessions: 0,
        totalVenueCost: 0,
        totalTeacherFee: 0,
        totalOtherCost: 0,
        totalCost: 0,
        totalRevenue: 0,
        accumulatedNetProfit: 0,
        averageAttendanceRate: 0
      };
    }

    const allAttendance = this.attendance();
    let totalVenueCost = 0;
    let totalTeacherFee = 0;
    let totalOtherCost = 0;
    let totalRevenue = 0;
    let completedCount = 0;
    let scheduledCount = 0;
    let totalAttendedCount = 0;
    let totalEnrolledCount = 0;

    for (const s of sessions) {
      if (s.status === 'completed') {
        completedCount++;
      } else if (s.status === 'scheduled') {
        scheduledCount++;
      }

      if (s.status !== 'cancelled') {
        const vCost = s.venueCost ?? course.defaultVenueCost ?? 2000;
        const tCost = s.teacherFee ?? course.defaultTeacherFee ?? 1200;
        const oCost = s.otherCost ?? 0;
        totalVenueCost += vCost;
        totalTeacherFee += tCost;
        totalOtherCost += oCost;

        const records = allAttendance.filter(a => a.sessionId === s.id);
        let billable = 0;
        let attended = 0;

        for (const r of records) {
          if (r.status === 'attended') {
            attended++;
            billable++;
          } else if (r.status === 'leave_late' || r.status === 'absent' || r.status === 'registered') {
            billable++;
          }
        }

        const fee = s.feePerStudent ?? course.defaultFeePerStudent ?? 500;
        totalRevenue += billable * fee;
        totalAttendedCount += attended;
        totalEnrolledCount += records.length;
      }
    }

    const totalCost = totalVenueCost + totalTeacherFee + totalOtherCost;
    const accumulatedNetProfit = totalRevenue - totalCost;
    const averageAttendanceRate = totalEnrolledCount > 0
      ? Math.round((totalAttendedCount / totalEnrolledCount) * 100)
      : 0;

    return {
      courseId: course.id,
      courseTitle: course.title,
      totalSessions: course.totalSessions,
      completedSessions: completedCount,
      scheduledSessions: scheduledCount,
      totalVenueCost,
      totalTeacherFee,
      totalOtherCost,
      totalCost,
      totalRevenue,
      accumulatedNetProfit,
      averageAttendanceRate
    };
  });

  // 4. 學員在該課程各堂課的出席狀態與進度明細 Computed
  readonly currentCourseStudentProgress = computed<StudentCourseProgress[]>(() => {
    const course = this.currentCourse();
    const sessions = this.currentCourseSessions();
    if (!course) return [];

    const students = this.students();
    const allAttendance = this.attendance();

    return students.map(stu => {
      let attendedCount = 0;
      let leaveCount = 0;
      let absentCount = 0;
      let registeredCount = 0;

      const sessionDetails: StudentCourseSessionDetail[] = sessions.map((s, idx) => {
        const rec = allAttendance.find(a => a.sessionId === s.id && a.studentId === stu.id);
        const sessionIndex = s.sessionIndex ?? (idx + 1);
        if (!rec) {
          return {
            sessionId: s.id,
            sessionIndex,
            date: s.date,
            status: 'unregistered' as const
          };
        }

        if (rec.status === 'attended') attendedCount++;
        else if (rec.status === 'leave_advance' || rec.status === 'leave_late') leaveCount++;
        else if (rec.status === 'absent') absentCount++;
        else if (rec.status === 'registered') registeredCount++;

        return {
          sessionId: s.id,
          sessionIndex,
          date: s.date,
          status: rec.status,
          signedAt: rec.signedAt
        };
      });

      const totalCourseSessions = course.totalSessions || (sessions.length > 0 ? sessions.length : 1);
      const attendanceRate = totalCourseSessions > 0
        ? Math.round((attendedCount / totalCourseSessions) * 100)
        : 0;

      return {
        studentId: stu.id,
        studentName: stu.name,
        attendedCount,
        leaveCount,
        absentCount,
        registeredCount,
        totalCourseSessions,
        attendanceRate,
        sessionDetails
      };
    });
  });

  // 5. 當前課堂 Computed
  readonly currentSession = computed(() => {
    const id = this.selectedSessionId();
    return this.sessions().find(s => s.id === id) || this.sessions()[0];
  });

  // 6. 當前課堂所有學生簽到記錄 Computed
  readonly currentSessionAttendance = computed(() => {
    const curr = this.currentSession();
    if (!curr) return [];
    const records = this.attendance().filter(a => a.sessionId === curr.id);
    const stuList = this.students();
    const packList = this.ticketPacks();

    return records.map(rec => {
      const stu = stuList.find(s => s.id === rec.studentId) || { id: rec.studentId, name: rec.studentName || '未知名稱', phone: '', registeredAt: '' };
      const activePack = packList.find(p => p.studentId === rec.studentId && p.status === 'active');

      return {
        ...rec,
        student: stu,
        activePack
      };
    });
  });

  // 7. 當前課堂財務與開班門檻損益 Computed
  readonly currentSessionFinancials = computed<SessionFinancialStats>(() => {
    const curr = this.currentSession();
    if (!curr) {
      return {
        totalCapacity: 10,
        expectedAttendees: 0,
        actualAttendedCount: 0,
        advanceLeaveCount: 0,
        lateLeaveCount: 0,
        absentCount: 0,
        minThreshold: 4,
        isAtRisk: false,
        effectiveRevenue: 0,
        venueCost: 2000,
        teacherFee: 1200,
        otherCost: 0,
        totalCost: 3200,
        estimatedNetProfit: -3200,
        breakEvenAttendees: 7
      };
    }

    const records = this.currentSessionAttendance();
    let attended = 0;
    let registered = 0;
    let advanceLeave = 0;
    let lateLeave = 0;
    let absent = 0;

    for (const r of records) {
      switch (r.status) {
        case 'attended':
          attended++;
          break;
        case 'registered':
          registered++;
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

    const expectedAttendees = registered + attended;
    // 有效計費人次 = 已出席 + 逾期請假扣堂 + 缺席扣堂 + 預約應到
    const billableCount = attended + lateLeave + absent + registered;
    const effectiveRevenue = billableCount * curr.feePerStudent;
    const venueCost = curr.venueCost;
    const teacherFee = curr.teacherFee ?? 1200;
    const otherCost = curr.otherCost ?? 0;
    const totalCost = venueCost + teacherFee + otherCost;
    const estimatedNetProfit = effectiveRevenue - totalCost;
    const breakEvenAttendees = Math.ceil(totalCost / (curr.feePerStudent || 1));
    const isAtRisk = expectedAttendees < curr.minThreshold;

    return {
      totalCapacity: curr.maxCapacity,
      expectedAttendees,
      actualAttendedCount: attended,
      advanceLeaveCount: advanceLeave,
      lateLeaveCount: lateLeave,
      absentCount: absent,
      minThreshold: curr.minThreshold,
      isAtRisk,
      effectiveRevenue,
      venueCost,
      teacherFee,
      otherCost,
      totalCost,
      estimatedNetProfit,
      breakEvenAttendees
    };
  });

  // 4. 當前選取的學生 Computed (供學員自助手機能查閱)
  readonly currentStudent = computed(() => {
    const id = this.selectedStudentId();
    return this.students().find(s => s.id === id);
  });

  readonly currentStudentPack = computed(() => {
    const id = this.selectedStudentId();
    return this.ticketPacks().find(p => p.studentId === id && p.status === 'active');
  });

  readonly currentStudentAttendanceRecord = computed(() => {
    const curr = this.currentSession();
    const stuId = this.selectedStudentId();
    if (!curr) return null;
    return this.attendance().find(a => a.sessionId === curr.id && a.studentId === stuId);
  });

  // 5. 所有學生及其票卡總覽 Computed
  readonly studentsWithPacks = computed<StudentWithActivePack[]>(() => {
    const stus = this.students();
    const packs = this.ticketPacks();
    const today = new Date();

    return stus.map(stu => {
      const activePack = packs.find(p => p.studentId === stu.id && p.status === 'active');
      let daysUntilExpiry = 0;
      let isNearExpiry = false;

      if (activePack) {
        const expiry = new Date(activePack.expiryDate);
        const diffMs = expiry.getTime() - today.getTime();
        daysUntilExpiry = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        isNearExpiry = daysUntilExpiry <= 14;
      }

      return {
        ...stu,
        activePack,
        daysUntilExpiry,
        isNearExpiry
      };
    });
  });

  constructor() {
    this.loadInitialData();

    // 當狀態改變時自動同步至 LocalStorage
    effect(() => {
      const stateToSave = {
        courses: this.courses(),
        selectedCourseId: this.selectedCourseId(),
        students: this.students(),
        ticketPacks: this.ticketPacks(),
        sessions: this.sessions(),
        attendance: this.attendance(),
        selectedSessionId: this.selectedSessionId(),
        selectedStudentId: this.selectedStudentId(),
        simulationHoursUntilClass: this.simulationHoursUntilClass()
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
      } catch (e) {
        console.warn('Could not save to localStorage', e);
      }
    });

    // 若 API 模組可用，啟動時向後端嘗試獲取最新資料進行比對重整
    if (this.api?.isAvailable) {
      this.refreshFromBackend();
    }
  }

  // 從後端 FastAPI 服務重整最新資料
  refreshFromBackend(): void {
    if (!this.api || !this.api.isAvailable) return;
    this.isSyncing.set(true);

    let syncError: string | null = null;
    forkJoin({
      students: this.api.getStudents().pipe(catchError(err => {
        syncError = err?.message || 'API sync failed';
        return of(null);
      })),
      sessions: this.api.getSessions().pipe(catchError(err => {
        if (!syncError) syncError = err?.message || 'API sync failed';
        return of(null);
      }))
    }).subscribe({
      next: ({ students, sessions }) => {
        if (students && sessions) {
          this.isOnline.set(true);
          this.lastSyncError.set(null);
          this.students.set(students);
          this.sessions.set(sessions);

          // 從學員中提取 active 票卡
          const packs: TicketPack[] = [];
          for (const s of students) {
            if (s.activePack) {
              packs.push(s.activePack);
            }
          }
          if (packs.length > 0) {
            this.ticketPacks.set(packs);
          }

          // 抓取當前選取課堂的出勤資料
          const curr = this.currentSession();
          if (curr) {
            this.api!.getSessionAttendance(curr.id).pipe(catchError(() => of([]))).subscribe(records => {
              if (records && records.length > 0) {
                this.attendance.set(records);
              }
            });
          }
        } else {
          this.isOnline.set(false);
          this.lastSyncError.set(syncError || 'API sync failed');
        }
        this.isSyncing.set(false);
      },
      error: (err) => {
        this.isOnline.set(false);
        this.isSyncing.set(false);
        this.lastSyncError.set(err?.message || 'API sync failed');
        console.warn('Ballet API sync failed, continuing in offline/demo mode', err);
      }
    });
  }

  // 手寫簽名簽到核心 (iPad 模式 A)
  checkInWithSignature(studentId: string, signatureDataUrl: string): { success: boolean; message: string } {
    const session = this.currentSession();
    if (!session) return { success: false, message: '查無當前課程' };

    const student = this.students().find(s => s.id === studentId);
    if (!student) return { success: false, message: '查無該學員' };

    const pack = this.ticketPacks().find(p => p.studentId === studentId && p.status === 'active');
    if (!pack || pack.remainingCount <= 0) {
      return { success: false, message: `${student.name} 的票卡堂數已用罄，請先儲值！` };
    }

    const now = new Date();
    const timeString = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;

    // 1. 本地立即扣抵票卡 1 堂 (樂觀更新)
    const updatedPacks = this.ticketPacks().map(p => {
      if (p.id === pack.id) {
        const remaining = p.remainingCount - 1;
        return {
          ...p,
          remainingCount: remaining,
          status: remaining <= 0 ? ('depleted' as const) : ('active' as const)
        };
      }
      return p;
    });
    this.ticketPacks.set(updatedPacks);

    // 2. 本地立即更新或新增出席紀錄
    const existingRecIndex = this.attendance().findIndex(
      a => a.sessionId === session.id && a.studentId === studentId
    );

    const newRecord: AttendanceRecord = {
      id: `att-${session.id}-${studentId}`,
      sessionId: session.id,
      studentId: studentId,
      studentName: student.name,
      status: 'attended',
      signatureDataUrl,
      signedAt: timeString,
      deductedCount: 1,
      remark: '教室 iPad 現場手寫簽到'
    };

    if (existingRecIndex >= 0) {
      const updatedAtt = [...this.attendance()];
      updatedAtt[existingRecIndex] = newRecord;
      this.attendance.set(updatedAtt);
    } else {
      this.attendance.set([...this.attendance(), newRecord]);
    }

    // 3. 背景非同步同步至後端 API
    if (this.api?.isAvailable) {
      this.api.checkIn(session.id, studentId, signatureDataUrl).subscribe({
        next: (res) => {
          if (res.record) {
            this.upsertAttendance(res.record);
          }
        },
        error: (err) => {
          console.warn('Background check-in sync failed', err);
          this.lastSyncError.set(err.message || '簽到同步失敗');
        }
      });
    }

    return { success: true, message: `✅ ${student.name} 簽到成功！剩餘 ${pack.remainingCount - 1} 堂。` };
  }

  // 學員端提出請假 (自動以 24h 規則判斷)
  requestLeave(studentId: string, reason?: string): { success: boolean; isAdvance: boolean; message: string } {
    const session = this.currentSession();
    if (!session) return { success: false, isAdvance: false, message: '查無當前課程' };

    const student = this.students().find(s => s.id === studentId);
    if (!student) return { success: false, isAdvance: false, message: '查無該學員' };

    const pack = this.ticketPacks().find(p => p.studentId === studentId && p.status === 'active');
    const hoursLeft = this.simulationHoursUntilClass();
    const isAdvance = hoursLeft >= 24;

    const now = new Date().toISOString();

    if (isAdvance) {
      // 24 小時前：不扣堂數
      const newRecord: AttendanceRecord = {
        id: `att-${session.id}-${studentId}`,
        sessionId: session.id,
        studentId,
        studentName: student.name,
        status: 'leave_advance',
        deductedCount: 0,
        leaveRequestedAt: now,
        leaveReason: reason || '提前請假 (保有堂數)',
        remark: `開課前 ${hoursLeft} 小時線上請假，完整保留堂數`
      };

      this.upsertAttendance(newRecord);

      // 背景非同步同步至後端 API
      if (this.api?.isAvailable) {
        this.api.requestLeave(session.id, studentId, reason, hoursLeft).subscribe({
          next: (res) => {
            if (res.record) {
              this.upsertAttendance(res.record);
            }
          },
          error: (err) => {
            console.warn('Background leave request sync failed', err);
            this.lastSyncError.set(err.message || '請假同步失敗');
          }
        });
      }

      return {
        success: true,
        isAdvance: true,
        message: `您已成功請假！距開課還有 ${hoursLeft} 小時，堂數完整保留不扣除。`
      };
    } else {
      // 24 小時內：扣除 1 堂（場租防虧損規則）
      if (pack && pack.remainingCount > 0) {
        const updatedPacks = this.ticketPacks().map(p => {
          if (p.id === pack.id) {
            const remaining = p.remainingCount - 1;
            return {
              ...p,
              remainingCount: remaining,
              status: remaining <= 0 ? ('depleted' as const) : ('active' as const)
            };
          }
          return p;
        });
        this.ticketPacks.set(updatedPacks);
      }

      const newRecord: AttendanceRecord = {
        id: `att-${session.id}-${studentId}`,
        sessionId: session.id,
        studentId,
        studentName: student.name,
        status: 'leave_late',
        deductedCount: 1,
        leaveRequestedAt: now,
        leaveReason: reason || '逾時請假 (分攤場租扣堂)',
        remark: `開課前 ${hoursLeft} 小時請假（未達24小時前），依規則扣抵 1 堂場租`
      };

      this.upsertAttendance(newRecord);

      // 背景非同步同步至後端 API
      if (this.api?.isAvailable) {
        this.api.requestLeave(session.id, studentId, reason, hoursLeft).subscribe({
          next: (res) => {
            if (res.record) {
              this.upsertAttendance(res.record);
            }
          },
          error: (err) => {
            console.warn('Background leave request sync failed', err);
            this.lastSyncError.set(err.message || '請假同步失敗');
          }
        });
      }

      return {
        success: true,
        isAdvance: false,
        message: `距開課僅剩 ${hoursLeft} 小時（不足24小時），已為您完成請假，並依教室場租分攤規定扣抵 1 堂。`
      };
    }
  }

  // 取消請假，恢復預約出席
  cancelLeave(studentId: string) {
    const session = this.currentSession();
    if (!session) return;

    const existingRec = this.attendance().find(
      a => a.sessionId === session.id && a.studentId === studentId
    );

    // 若先前是逾時請假被扣堂，取消請假時歸還堂數
    if (existingRec && existingRec.status === 'leave_late' && existingRec.deductedCount > 0) {
      const pack = this.ticketPacks().find(p => p.studentId === studentId && p.status === 'active');
      if (pack) {
        const updatedPacks = this.ticketPacks().map(p => {
          if (p.id === pack.id) {
            return { ...p, remainingCount: p.remainingCount + 1, status: 'active' as const };
          }
          return p;
        });
        this.ticketPacks.set(updatedPacks);
      }
    }

    const filtered = this.attendance().filter(
      a => !(a.sessionId === session.id && a.studentId === studentId)
    );
    this.attendance.set(filtered);

    // 背景非同步同步至後端 API
    if (this.api?.isAvailable) {
      this.api.cancelLeave(session.id, studentId).subscribe({
        error: (err) => {
          console.warn('Background cancel leave sync failed', err);
          this.lastSyncError.set(err.message || '取消請假同步失敗');
        }
      });
    }
  }

  // 老師手動操作 (如直接幫忙記出席或特例免扣堂)
  setStudentAttendanceStatus(studentId: string, status: AttendanceStatus) {
    const session = this.currentSession();
    if (!session) return;
    const student = this.students().find(s => s.id === studentId);
    if (!student) return;

    const newRecord: AttendanceRecord = {
      id: `att-${session.id}-${studentId}`,
      sessionId: session.id,
      studentId,
      studentName: student.name,
      status,
      deductedCount: (status === 'attended' || status === 'leave_late' || status === 'absent') ? 1 : 0,
      remark: '老師後台手動變更'
    };
    this.upsertAttendance(newRecord);

    // 背景非同步同步至後端 API
    if (this.api?.isAvailable) {
      this.api.updateAttendanceStatus(session.id, studentId, status, '老師後台手動變更').subscribe({
        next: (record) => {
          if (record) {
            this.upsertAttendance(record);
          }
        },
        error: (err) => {
          console.warn('Background update attendance sync failed', err);
          this.lastSyncError.set(err.message || '更新出勤狀態同步失敗');
        }
      });
    }
  }

  // 手動將學員加入指定課堂名冊
  enrollStudentInSession(sessionId: string, studentId: string): AttendanceRecord | null {
    const session = this.sessions().find(s => s.id === sessionId);
    if (!session) return null;
    const student = this.students().find(s => s.id === studentId);
    if (!student) return null;

    // 檢查是否已在名冊中
    const existing = this.attendance().find(a => a.sessionId === sessionId && a.studentId === studentId);
    if (existing) {
      return existing;
    }

    const newRecord: AttendanceRecord = {
      id: `att-${sessionId}-${studentId}`,
      sessionId,
      studentId,
      studentName: student.name,
      status: 'registered',
      deductedCount: 0,
      remark: '老師手動加入課堂名冊'
    };

    this.attendance.set([...this.attendance(), newRecord]);

    if (this.api?.isAvailable) {
      this.api.updateAttendanceStatus(sessionId, studentId, 'registered', '老師手動加入課堂名冊').subscribe({
        next: (rec) => {
          if (rec) {
            this.upsertAttendance(rec);
          }
        },
        error: (err) => {
          console.warn('Background enroll student sync failed', err);
        }
      });
    }

    return newRecord;
  }

  // 自課堂名冊中移除學員
  removeStudentFromSession(sessionId: string, studentId: string): void {
    const existingRec = this.attendance().find(
      a => a.sessionId === sessionId && a.studentId === studentId
    );
    if (!existingRec) return;

    // 若有被扣堂數（例如已出席或逾期請假），移除時退還堂數
    if (existingRec.deductedCount > 0) {
      const pack = this.ticketPacks().find(p => p.studentId === studentId && p.status === 'active');
      if (pack) {
        const updatedPacks = this.ticketPacks().map(p => {
          if (p.id === pack.id) {
            return {
              ...p,
              remainingCount: p.remainingCount + existingRec.deductedCount,
              status: 'active' as const
            };
          }
          return p;
        });
        this.ticketPacks.set(updatedPacks);
      }
    }

    const filtered = this.attendance().filter(
      a => !(a.sessionId === sessionId && a.studentId === studentId)
    );
    this.attendance.set(filtered);
  }

  // 新增學員
  addStudent(params: CreateStudentParams): Student {
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const registeredAt = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const newId = `stu-${Date.now()}`;

    const newStudent: Student = {
      id: newId,
      name: params.name,
      phone: params.phone,
      notes: params.notes,
      registeredAt
    };

    this.students.set([...this.students(), newStudent]);

    // 若有選配初始票卡方案
    if (params.initialPackType && params.initialPackType !== 'none') {
      if (params.initialPackType === 'trial') {
        this.addTicketPack(newId, 'trial', 1, 14, 400);
      } else {
        const count = params.initialPackType === '5_class' ? 5 : 10;
        const validityDays = params.initialPackType === '5_class' ? 60 : 100;
        this.addTicketPack(newId, params.initialPackType, count, validityDays);
      }
    }

    // 背景非同步同步至後端 API
    if (this.api?.isAvailable) {
      this.api.createStudent(newStudent).subscribe({
        error: (err) => {
          console.warn('Background create student sync failed', err);
          this.lastSyncError.set(err.message || '新增學員同步失敗');
        }
      });
    }

    return newStudent;
  }

  // 編輯學員資料
  updateStudent(studentId: string, data: UpdateStudentParams): void {
    const updatedList = this.students().map(s => {
      if (s.id === studentId) {
        return {
          ...s,
          name: data.name,
          phone: data.phone,
          notes: data.notes
        };
      }
      return s;
    });
    this.students.set(updatedList);

    // 同步更新出勤名冊中的學生姓名
    const updatedAttendance = this.attendance().map(a => {
      if (a.studentId === studentId) {
        return {
          ...a,
          studentName: data.name
        };
      }
      return a;
    });
    this.attendance.set(updatedAttendance);

    // 背景非同步同步至後端 API
    if (this.api?.isAvailable) {
      this.api.updateStudent(studentId, data).subscribe({
        error: (err) => {
          console.warn('Background update student sync failed', err);
          this.lastSyncError.set(err.message || '更新學員同步失敗');
        }
      });
    }
  }

  // 刪除 / 減少學員
  deleteStudent(studentId: string): void {
    this.students.set(this.students().filter(s => s.id !== studentId));
    this.ticketPacks.set(this.ticketPacks().filter(p => p.studentId !== studentId));
    this.attendance.set(this.attendance().filter(a => a.studentId !== studentId));

    if (this.selectedStudentId() === studentId) {
      const remaining = this.students();
      this.selectedStudentId.set(remaining.length > 0 ? remaining[0].id : '');
    }

    // 背景非同步同步至後端 API
    if (this.api?.isAvailable) {
      this.api.deleteStudent(studentId).subscribe({
        error: (err) => {
          console.warn('Background delete student sync failed', err);
          this.lastSyncError.set(err.message || '刪除學員同步失敗');
        }
      });
    }
  }

  // 取得特定學員的完整上課歷程（依日期與開始時間降冪排序）
  getStudentAttendanceHistory(studentId: string): StudentAttendanceHistoryItem[] {
    const studentRecords = this.attendance().filter(a => a.studentId === studentId);
    const sessionList = this.sessions();

    const items: StudentAttendanceHistoryItem[] = studentRecords.map(record => ({
      record,
      session: sessionList.find(s => s.id === record.sessionId)
    }));

    return items.sort((a, b) => {
      const dateA = (a.session?.date || '') + ' ' + (a.session?.startTime || '');
      const dateB = (b.session?.date || '') + ' ' + (b.session?.startTime || '');
      return dateB.localeCompare(dateA);
    });
  }

  // 取得特定學員的所有票卡記錄（依購買日期降冪排序）
  getStudentTicketPacks(studentId: string): TicketPack[] {
    return this.ticketPacks()
      .filter(p => p.studentId === studentId)
      .sort((a, b) => b.purchaseDate.localeCompare(a.purchaseDate));
  }

  // 更新學員備註
  updateStudentNotes(studentId: string, notes: string): void {
    const stu = this.students().find(s => s.id === studentId);
    if (!stu) return;
    this.updateStudent(studentId, {
      name: stu.name,
      phone: stu.phone,
      notes: notes.trim() || undefined
    });
  }

  // 判斷學員是否曾購買過體驗課 (終身限購 1 次)
  hasPurchasedTrial(studentId: string): boolean {
    return this.ticketPacks().some(p => p.studentId === studentId && p.type === 'trial');
  }

  // 加購票卡 (體驗課 1 堂 / 5 堂 / 10 堂)
  addTicketPack(
    studentId: string,
    type: TicketPackType,
    count: number,
    validityDays: number,
    customPrice?: number
  ): { success: boolean; message: string; pack?: TicketPack } {
    // 終身限購 1 次體驗課防重複校驗
    if (type === 'trial' && this.hasPurchasedTrial(studentId)) {
      return {
        success: false,
        message: '每位學員終身限購 1 次體驗課，無法重複購買！建議選購 5 堂或 10 堂常規方案。'
      };
    }

    const today = new Date();
    const expiry = new Date(today);
    expiry.setDate(today.getDate() + validityDays);

    const pad = (n: number) => String(n).padStart(2, '0');
    const purchaseDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const expiryDate = `${expiry.getFullYear()}-${pad(expiry.getMonth() + 1)}-${pad(expiry.getDate())}`;

    const calculatedPrice = customPrice ?? (type === 'trial' ? 400 : count * 500);

    const newPack: TicketPack = {
      id: `pack-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      studentId,
      type,
      totalCount: count,
      remainingCount: count,
      purchaseDate,
      expiryDate,
      status: 'active',
      pricePaid: calculatedPrice
    };

    this.ticketPacks.set([...this.ticketPacks(), newPack]);

    // 背景非同步同步至後端 API
    if (this.api?.isAvailable) {
      this.api.purchaseTicketPack({
        studentId,
        type,
        totalCount: count,
        validityDays,
        pricePaid: calculatedPrice
      }).subscribe({
        error: (err) => {
          console.warn('Background purchase ticket pack sync failed', err);
          this.lastSyncError.set(err.message || '購票同步失敗');
        }
      });
    }

    const planLabel = type === 'trial' ? '單堂體驗課（1 堂）' : `${count} 堂課`;
    return {
      success: true,
      message: `✅ 已成功為學員儲值 ${planLabel}！`,
      pack: newPack
    };
  }

  // 展延票卡效期
  extendPackExpiry(packId: string, extraDays: number) {
    const updated = this.ticketPacks().map(p => {
      if (p.id === packId) {
        const currExpiry = new Date(p.expiryDate);
        currExpiry.setDate(currExpiry.getDate() + extraDays);
        const pad = (n: number) => String(n).padStart(2, '0');
        const newExpiryStr = `${currExpiry.getFullYear()}-${pad(currExpiry.getMonth() + 1)}-${pad(currExpiry.getDate())}`;
        return {
          ...p,
          expiryDate: newExpiryStr,
          status: p.remainingCount > 0 ? ('active' as const) : p.status
        };
      }
      return p;
    });
    this.ticketPacks.set(updated);

    // 背景非同步同步至後端 API
    if (this.api?.isAvailable) {
      this.api.extendTicketPack(packId, extraDays).subscribe({
        error: (err) => {
          console.warn('Background extend ticket pack sync failed', err);
          this.lastSyncError.set(err.message || '展延票卡同步失敗');
        }
      });
    }
  }

  // 開班門檻不足時，老師一鍵順延/停課 (避免場租損失)
  cancelSessionDueToThreshold(sessionId: string) {
    const updatedSessions = this.sessions().map(s => {
      if (s.id === sessionId) {
        return {
          ...s,
          status: 'cancelled' as const,
          cancellationReason: '人數未達最低開班門檻（場租損益防護退租）'
        };
      }
      return s;
    });
    this.sessions.set(updatedSessions);

    // 若有學生被扣了堂數（例如逾期請假或已簽到），全部退還堂數
    const records = this.attendance().filter(a => a.sessionId === sessionId);
    const packs = [...this.ticketPacks()];

    for (const r of records) {
      if (r.deductedCount > 0) {
        const packIndex = packs.findIndex(p => p.studentId === r.studentId);
        if (packIndex >= 0) {
          packs[packIndex] = {
            ...packs[packIndex],
            remainingCount: packs[packIndex].remainingCount + r.deductedCount,
            status: 'active'
          };
        }
      }
    }
    this.ticketPacks.set(packs);

    // 背景非同步同步至後端 API
    if (this.api?.isAvailable) {
      this.api.cancelSessionDueToThreshold(sessionId).subscribe({
        error: (err) => {
          console.warn('Background cancel session sync failed', err);
          this.lastSyncError.set(err.message || '順延停課同步失敗');
        }
      });
    }
  }

  // 建立新期班課程
  createCourse(params: CreateCourseParams): Course {
    const newCourse: Course = {
      id: `course-${Date.now()}`,
      title: params.title,
      description: params.description || '',
      totalSessions: params.totalSessions,
      defaultVenueCost: params.defaultVenueCost ?? 2000,
      defaultTeacherFee: params.defaultTeacherFee ?? 1200,
      defaultFeePerStudent: params.defaultFeePerStudent ?? 500,
      minThreshold: params.minThreshold ?? 4,
      status: 'active',
      startDate: params.startDate,
      endDate: params.endDate
    };

    this.courses.set([...this.courses(), newCourse]);
    this.selectedCourseId.set(newCourse.id);
    return newCourse;
  }

  // 切換當前選取的期班課程
  setSelectedCourse(courseId: string): void {
    this.selectedCourseId.set(courseId);
    const courseSessions = this.sessions()
      .filter(s => s.courseId === courseId)
      .sort((a, b) => (a.sessionIndex ?? 0) - (b.sessionIndex ?? 0) || a.date.localeCompare(b.date));

    if (courseSessions.length > 0) {
      const current = this.currentSession();
      if (!current || current.courseId !== courseId) {
        // 優先切換至尚未結束（scheduled）的課堂，若皆已結束或取消則回退至第一堂課
        const nextTargetSession = courseSessions.find(s => s.status === 'scheduled') || courseSessions[0];
        this.setSelectedSession(nextTargetSession.id);
      }
    }
  }

  // 為指定期班新增課堂
  addSessionToCourse(
    courseId: string,
    params: Partial<CreateClassSessionParams> & { date: string; title?: string }
  ): ClassSession {
    const course = this.courses().find(c => c.id === courseId);
    const existingSessions = this.sessions().filter(s => s.courseId === courseId);
    const sessionIndex = params.sessionIndex ?? (existingSessions.length + 1);

    const title = params.title || (course ? `${course.title} (第 ${sessionIndex} 堂)` : `第 ${sessionIndex} 堂課`);
    const venueCost = params.venueCost ?? course?.defaultVenueCost ?? 2000;
    const teacherFee = params.teacherFee ?? course?.defaultTeacherFee ?? 1200;
    const feePerStudent = params.feePerStudent ?? course?.defaultFeePerStudent ?? 500;
    const minThreshold = params.minThreshold ?? course?.minThreshold ?? 4;

    return this.createSession({
      courseId,
      sessionIndex,
      title,
      date: params.date,
      dayOfWeek: params.dayOfWeek,
      startTime: params.startTime || '14:00',
      endTime: params.endTime || '15:30',
      venueName: params.venueName || '敦南日光舞蹈排練室 A 廳',
      venueCost,
      teacherFee,
      otherCost: params.otherCost ?? 0,
      feePerStudent,
      maxCapacity: params.maxCapacity ?? 10,
      minThreshold
    });
  }

  // 取得特定學員在指定課程中的進度與出勤明細
  getStudentCourseProgress(studentId: string, courseId?: string): StudentCourseProgress | null {
    const targetCourseId = courseId || this.selectedCourseId();
    const course = this.courses().find(c => c.id === targetCourseId);
    if (!course) return null;
    const stu = this.students().find(s => s.id === studentId);
    if (!stu) return null;

    const sessions = this.sessions()
      .filter(s => s.courseId === course.id)
      .sort((a, b) => (a.sessionIndex ?? 0) - (b.sessionIndex ?? 0) || a.date.localeCompare(b.date));
    const allAttendance = this.attendance();

    let attendedCount = 0;
    let leaveCount = 0;
    let absentCount = 0;
    let registeredCount = 0;

    const sessionDetails: StudentCourseSessionDetail[] = sessions.map((s, idx) => {
      const rec = allAttendance.find(a => a.sessionId === s.id && a.studentId === stu.id);
      const sessionIndex = s.sessionIndex ?? (idx + 1);
      if (!rec) {
        return {
          sessionId: s.id,
          sessionIndex,
          date: s.date,
          status: 'unregistered' as const
        };
      }

      if (rec.status === 'attended') attendedCount++;
      else if (rec.status === 'leave_advance' || rec.status === 'leave_late') leaveCount++;
      else if (rec.status === 'absent') absentCount++;
      else if (rec.status === 'registered') registeredCount++;

      return {
        sessionId: s.id,
        sessionIndex,
        date: s.date,
        status: rec.status,
        signedAt: rec.signedAt
      };
    });

    const totalCourseSessions = course.totalSessions || (sessions.length > 0 ? sessions.length : 1);
    const attendanceRate = totalCourseSessions > 0
      ? Math.round((attendedCount / totalCourseSessions) * 100)
      : 0;

    return {
      studentId: stu.id,
      studentName: stu.name,
      attendedCount,
      leaveCount,
      absentCount,
      registeredCount,
      totalCourseSessions,
      attendanceRate,
      sessionDetails
    };
  }

  // 建立新課堂班次
  createSession(sessionData: CreateClassSessionParams): ClassSession {
    const days = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
    const d = new Date(`${sessionData.date}T00:00:00`);
    const dayOfWeek = sessionData.dayOfWeek || (!isNaN(d.getDay()) ? days[d.getDay()] : '週六');

    const course = sessionData.courseId ? this.courses().find(c => c.id === sessionData.courseId) : undefined;
    const sessionIndex = sessionData.sessionIndex || (sessionData.courseId ? this.sessions().filter(s => s.courseId === sessionData.courseId).length + 1 : 1);
    const sessionTitle = sessionData.title || (course ? `${course.title} (第 ${sessionIndex} 堂)` : `芭蕾課堂 (第 ${sessionIndex} 堂)`);

    const newSession: ClassSession = {
      id: `session-${sessionData.date}-${Date.now().toString().slice(-4)}`,
      courseId: sessionData.courseId,
      sessionIndex,
      date: sessionData.date,
      dayOfWeek,
      startTime: sessionData.startTime,
      endTime: sessionData.endTime,
      title: sessionTitle,
      venueName: sessionData.venueName,
      venueCost: sessionData.venueCost ?? 2000,
      teacherFee: sessionData.teacherFee ?? 1200,
      otherCost: sessionData.otherCost ?? 0,
      feePerStudent: sessionData.feePerStudent ?? 500,
      maxCapacity: sessionData.maxCapacity ?? 10,
      minThreshold: sessionData.minThreshold ?? 4,
      status: 'scheduled'
    };

    this.sessions.set([newSession, ...this.sessions()]);
    this.selectedSessionId.set(newSession.id);

    if (newSession.courseId) {
      this.selectedCourseId.set(newSession.courseId);
    }

    // 背景非同步同步至後端 API
    if (this.api?.isAvailable) {
      this.api.createSession(newSession).subscribe({
        error: (err) => {
          console.warn('Background create session sync failed', err);
          this.lastSyncError.set(err.message || '建立課堂同步失敗');
        }
      });
    }

    return newSession;
  }

  // 切換當前選定的課堂
  setSelectedSession(sessionId: string): void {
    this.selectedSessionId.set(sessionId);
    const session = this.sessions().find(s => s.id === sessionId);
    if (session?.courseId) {
      this.selectedCourseId.set(session.courseId);
    }

    if (this.api?.isAvailable) {
      this.api.getSessionAttendance(sessionId).pipe(catchError(() => of([]))).subscribe(records => {
        if (records && records.length > 0) {
          const others = this.attendance().filter(a => a.sessionId !== sessionId);
          this.attendance.set([...others, ...records]);
        }
      });
    }
  }

  setSimulationHours(hours: number) {
    this.simulationHoursUntilClass.set(hours);
  }

  setSelectedStudent(studentId: string) {
    this.selectedStudentId.set(studentId);
  }

  private upsertAttendance(newRecord: AttendanceRecord) {
    const idx = this.attendance().findIndex(
      a => a.sessionId === newRecord.sessionId && a.studentId === newRecord.studentId
    );
    if (idx >= 0) {
      const updated = [...this.attendance()];
      updated[idx] = newRecord;
      this.attendance.set(updated);
    } else {
      this.attendance.set([...this.attendance(), newRecord]);
    }
  }

  // 重置回預設範例資料
  resetMockData() {
    localStorage.removeItem(STORAGE_KEY);
    this.loadInitialData();

    // 背景非同步重置後端 API 資料庫
    if (this.api?.isAvailable) {
      this.api.resetSystem().subscribe({
        next: () => {
          this.refreshFromBackend();
        },
        error: (err) => {
          console.warn('Background reset system sync failed', err);
        }
      });
    }
  }

  private loadInitialData() {
    // 預設期班課程
    const initialCourses: Course[] = [
      {
        id: 'course-1',
        title: '成人優雅芭蕾美姿體雕班 (秋季初階期班)',
        description: '專為初學者量身打造，結合芭蕾核心體態雕塑與優雅身形延展。',
        totalSessions: 8,
        defaultVenueCost: 2000,
        defaultTeacherFee: 1200,
        defaultFeePerStudent: 500,
        minThreshold: 4,
        status: 'active',
        startDate: '2026-09-12',
        endDate: '2026-10-31'
      },
      {
        id: 'course-2',
        title: '成人芭蕾足尖技巧進階班 (週四夜間期班)',
        description: '針對具備基礎學員，深入訓練腳踝足弓肌力與足尖平穩度。',
        totalSessions: 6,
        defaultVenueCost: 2000,
        defaultTeacherFee: 1200,
        defaultFeePerStudent: 550,
        minThreshold: 4,
        status: 'active',
        startDate: '2026-09-17',
        endDate: '2026-10-22'
      }
    ];

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.students && parsed.sessions) {
          if (parsed.courses && parsed.courses.length > 0) {
            this.courses.set(parsed.courses);
          } else {
            this.courses.set(initialCourses);
          }
          this.selectedCourseId.set(parsed.selectedCourseId || 'course-1');
          this.students.set(parsed.students);
          this.ticketPacks.set(parsed.ticketPacks);
          this.sessions.set(parsed.sessions);
          this.attendance.set(parsed.attendance);
          this.selectedSessionId.set(parsed.selectedSessionId || 'session-upcoming');
          this.selectedStudentId.set(parsed.selectedStudentId || 'stu-1');
          this.simulationHoursUntilClass.set(parsed.simulationHoursUntilClass ?? 30);
          return;
        }
      } catch (e) {
        console.warn('Failed parsing saved state, resetting to mock', e);
      }
    }

    // 10 位學員（40~70 歲真實姓名情境）
    const initialStudents: Student[] = [
      { id: 'stu-1', name: '陳秀琴', phone: '0912-345-678', notes: '芭蕾3年經驗', registeredAt: '2025-01-10' },
      { id: 'stu-2', name: '王美玲', phone: '0923-456-789', notes: '膝蓋舊傷，動作適度', registeredAt: '2025-02-15' },
      { id: 'stu-3', name: '林秋月', phone: '0934-567-890', notes: '退休公務員', registeredAt: '2025-03-01' },
      { id: 'stu-4', name: '張月霞', phone: '0945-678-901', notes: '全勤模範生', registeredAt: '2025-01-20' },
      { id: 'stu-5', name: '許素貞', phone: '0956-789-012', notes: '常與桂芬一起報名', registeredAt: '2025-04-12' },
      { id: 'stu-6', name: '黃桂芬', phone: '0967-890-123', notes: '核心肌力極佳', registeredAt: '2025-04-12' },
      { id: 'stu-7', name: '曾美雲', phone: '0978-901-234', notes: '熱心班長', registeredAt: '2025-02-01' },
      { id: 'stu-8', name: '吳淑慧', phone: '0989-012-345', notes: '喜歡軟度伸展', registeredAt: '2025-05-05' },
      { id: 'stu-9', name: '蔡玉蓮', phone: '0911-222-333', notes: '每週固定週六到課', registeredAt: '2025-03-20' },
      { id: 'stu-10', name: '鄭麗卿', phone: '0922-333-444', notes: '新加入學員', registeredAt: '2025-06-01' }
    ];

    // 票卡資料 (5堂與10堂方案，設定具體到期日)
    const initialPacks: TicketPack[] = [
      { id: 'pack-1', studentId: 'stu-1', type: '10_class', totalCount: 10, remainingCount: 7, purchaseDate: '2026-08-01', expiryDate: '2026-11-15', status: 'active', pricePaid: 5000 },
      { id: 'pack-2', studentId: 'stu-2', type: '5_class', totalCount: 5, remainingCount: 1, purchaseDate: '2026-07-20', expiryDate: '2026-09-28', status: 'active', pricePaid: 2500 },
      { id: 'pack-3', studentId: 'stu-3', type: '10_class', totalCount: 10, remainingCount: 4, purchaseDate: '2026-08-10', expiryDate: '2026-11-20', status: 'active', pricePaid: 5000 },
      { id: 'pack-4', studentId: 'stu-4', type: '10_class', totalCount: 10, remainingCount: 9, purchaseDate: '2026-09-01', expiryDate: '2026-12-15', status: 'active', pricePaid: 5000 },
      { id: 'pack-5', studentId: 'stu-5', type: '5_class', totalCount: 5, remainingCount: 3, purchaseDate: '2026-08-15', expiryDate: '2026-10-30', status: 'active', pricePaid: 2500 },
      { id: 'pack-6', studentId: 'stu-6', type: '10_class', totalCount: 10, remainingCount: 5, purchaseDate: '2026-08-05', expiryDate: '2026-11-25', status: 'active', pricePaid: 5000 },
      { id: 'pack-7', studentId: 'stu-7', type: '10_class', totalCount: 10, remainingCount: 6, purchaseDate: '2026-08-20', expiryDate: '2026-11-30', status: 'active', pricePaid: 5000 },
      { id: 'pack-8', studentId: 'stu-8', type: '5_class', totalCount: 5, remainingCount: 2, purchaseDate: '2026-08-18', expiryDate: '2026-10-25', status: 'active', pricePaid: 2500 },
      { id: 'pack-9', studentId: 'stu-9', type: '10_class', totalCount: 10, remainingCount: 8, purchaseDate: '2026-09-05', expiryDate: '2026-12-20', status: 'active', pricePaid: 5000 },
      { id: 'pack-10', studentId: 'stu-10', type: '5_class', totalCount: 5, remainingCount: 4, purchaseDate: '2026-08-25', expiryDate: '2026-11-05', status: 'active', pricePaid: 2500 }
    ];

    // 多堂課班次 (涵蓋 course-1 與 course-2)
    const initialSessions: ClassSession[] = [
      {
        id: 'session-upcoming',
        courseId: 'course-1',
        sessionIndex: 2,
        date: '2026-09-19',
        dayOfWeek: '週六',
        startTime: '14:00',
        endTime: '15:30',
        title: '成人優雅芭蕾美姿體雕班 (第 2 堂)',
        venueName: '敦南日光舞蹈排練室 A 廳',
        venueCost: 2000,
        teacherFee: 1200,
        otherCost: 0,
        feePerStudent: 500,
        maxCapacity: 10,
        minThreshold: 4,
        status: 'scheduled'
      },
      {
        id: 'session-prev',
        courseId: 'course-1',
        sessionIndex: 1,
        date: '2026-09-12',
        dayOfWeek: '週六',
        startTime: '14:00',
        endTime: '15:30',
        title: '成人優雅芭蕾美姿體雕班 (第 1 堂)',
        venueName: '敦南日光舞蹈排練室 A 廳',
        venueCost: 2000,
        teacherFee: 1200,
        otherCost: 0,
        feePerStudent: 500,
        maxCapacity: 10,
        minThreshold: 4,
        status: 'completed'
      },
      {
        id: 'session-course-1-3',
        courseId: 'course-1',
        sessionIndex: 3,
        date: '2026-09-26',
        dayOfWeek: '週六',
        startTime: '14:00',
        endTime: '15:30',
        title: '成人優雅芭蕾美姿體雕班 (第 3 堂)',
        venueName: '敦南日光舞蹈排練室 A 廳',
        venueCost: 2000,
        teacherFee: 1200,
        otherCost: 0,
        feePerStudent: 500,
        maxCapacity: 10,
        minThreshold: 4,
        status: 'scheduled'
      },
      {
        id: 'session-course-2-1',
        courseId: 'course-2',
        sessionIndex: 1,
        date: '2026-09-17',
        dayOfWeek: '週四',
        startTime: '19:30',
        endTime: '21:00',
        title: '成人芭蕾足尖技巧進階班 (第 1 堂)',
        venueName: '敦南日光舞蹈排練室 B 廳',
        venueCost: 2000,
        teacherFee: 1200,
        otherCost: 0,
        feePerStudent: 550,
        maxCapacity: 10,
        minThreshold: 4,
        status: 'completed'
      },
      {
        id: 'session-course-2-2',
        courseId: 'course-2',
        sessionIndex: 2,
        date: '2026-09-24',
        dayOfWeek: '週四',
        startTime: '19:30',
        endTime: '21:00',
        title: '成人芭蕾足尖技巧進階班 (第 2 堂)',
        venueName: '敦南日光舞蹈排練室 B 廳',
        venueCost: 2000,
        teacherFee: 1200,
        otherCost: 0,
        feePerStudent: 550,
        maxCapacity: 10,
        minThreshold: 4,
        status: 'scheduled'
      }
    ];

    // 初始出勤展示：
    const sampleSignatureSvg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><path d="M20,50 Q60,10 90,45 T170,30" fill="none" stroke="%231a365d" stroke-width="4" stroke-linecap="round"/></svg>';

    const initialAttendance: AttendanceRecord[] = [
      // 第 1 堂已完成課堂出勤
      ...initialStudents.slice(0, 8).map((s, idx) => ({
        id: `att-prev-${s.id}`,
        sessionId: 'session-prev',
        studentId: s.id,
        studentName: s.name,
        status: 'attended' as const,
        signatureDataUrl: sampleSignatureSvg,
        signedAt: `13:5${idx}:10`,
        deductedCount: 1,
        remark: '首堂課完成簽名出席'
      })),
      // 第 2 堂課出勤
      {
        id: 'att-upcoming-stu-1',
        sessionId: 'session-upcoming',
        studentId: 'stu-1',
        studentName: '陳秀琴',
        status: 'attended',
        signatureDataUrl: sampleSignatureSvg,
        signedAt: '13:55:20',
        deductedCount: 1,
        remark: '教室 iPad 現場手寫簽到'
      },
      {
        id: 'att-upcoming-stu-2',
        sessionId: 'session-upcoming',
        studentId: 'stu-2',
        studentName: '王美玲',
        status: 'leave_advance',
        deductedCount: 0,
        leaveRequestedAt: '2026-09-17T10:30:00',
        leaveReason: '家族聚餐提前請假',
        remark: '開課前 36 小時請假，完整保留堂數'
      },
      ...initialStudents.slice(2).map(s => ({
        id: `att-upcoming-${s.id}`,
        sessionId: 'session-upcoming',
        studentId: s.id,
        studentName: s.name,
        status: 'registered' as const,
        deductedCount: 0
      }))
    ];

    this.courses.set(initialCourses);
    this.selectedCourseId.set('course-1');
    this.students.set(initialStudents);
    this.ticketPacks.set(initialPacks);
    this.sessions.set(initialSessions);
    this.attendance.set(initialAttendance);
    this.selectedSessionId.set('session-upcoming');
    this.selectedStudentId.set('stu-1');
    this.simulationHoursUntilClass.set(30);
  }
}
