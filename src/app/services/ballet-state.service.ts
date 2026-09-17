import { Injectable, signal, computed, effect } from '@angular/core';
import { Student, TicketPack, StudentWithActivePack, TicketPackType } from '../types/student.type';
import { AttendanceRecord, AttendanceStatus, ClassSession, SessionFinancialStats } from '../types/attendance.type';

const STORAGE_KEY = 'triple_d_ballet_state_v1';

@Injectable({
  providedIn: 'root'
})
export class BalletStateService {
  // 基礎 Signals
  readonly students = signal<Student[]>([]);
  readonly ticketPacks = signal<TicketPack[]>([]);
  readonly sessions = signal<ClassSession[]>([]);
  readonly attendance = signal<AttendanceRecord[]>([]);

  // 當前選取狀態
  readonly selectedSessionId = signal<string>('session-upcoming');
  readonly selectedStudentId = signal<string>('stu-1');

  // 測試輔助：模擬距離開課的小時數（預設 30 小時，方便切換驗證 24h 前後）
  readonly simulationHoursUntilClass = signal<number>(30);

  // 1. 當前課堂 Computed
  readonly currentSession = computed(() => {
    const id = this.selectedSessionId();
    return this.sessions().find(s => s.id === id) || this.sessions()[0];
  });

  // 2. 當前課堂所有學生簽到記錄 Computed
  readonly currentSessionAttendance = computed(() => {
    const curr = this.currentSession();
    if (!curr) return [];
    const records = this.attendance().filter(a => a.sessionId === curr.id);
    const stuList = this.students();
    const packList = this.ticketPacks();

    return stuList.map(stu => {
      const rec = records.find(r => r.studentId === stu.id);
      const activePack = packList.find(p => p.studentId === stu.id && p.status === 'active');

      const defaultRecord: AttendanceRecord = {
        id: `att-${curr.id}-${stu.id}`,
        sessionId: curr.id,
        studentId: stu.id,
        studentName: stu.name,
        status: 'registered',
        deductedCount: 0
      };

      return {
        ...(rec || defaultRecord),
        student: stu,
        activePack
      };
    });
  });

  // 3. 當前課堂財務與開班門檻損益 Computed
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
        estimatedNetProfit: 0
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
    // 有效計費人次 = 已出席 + 逾期請假扣堂 + 缺席扣堂
    const billableCount = attended + lateLeave + absent + registered; // 預約中的若開課即計費
    const effectiveRevenue = billableCount * curr.feePerStudent;
    const estimatedNetProfit = effectiveRevenue - curr.venueCost;
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
      venueCost: curr.venueCost,
      estimatedNetProfit
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

    // 1. 扣抵票卡 1 堂
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

    // 2. 更新或新增出席紀錄
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
  }

  // 加購票卡 (5 堂 / 10 堂)
  addTicketPack(studentId: string, type: TicketPackType, count: number, validityDays: number) {
    const today = new Date();
    const expiry = new Date(today);
    expiry.setDate(today.getDate() + validityDays);

    const pad = (n: number) => String(n).padStart(2, '0');
    const purchaseDate = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const expiryDate = `${expiry.getFullYear()}-${pad(expiry.getMonth() + 1)}-${pad(expiry.getDate())}`;

    // 先將先前的 active 票卡結案或展延
    const newPack: TicketPack = {
      id: `pack-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      studentId,
      type,
      totalCount: count,
      remainingCount: count,
      purchaseDate,
      expiryDate,
      status: 'active',
      pricePaid: count * 500
    };

    this.ticketPacks.set([...this.ticketPacks(), newPack]);
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
  }

  private loadInitialData() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.students && parsed.sessions) {
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

    // 週六課程
    const initialSessions: ClassSession[] = [
      {
        id: 'session-upcoming',
        date: '2026-09-19',
        dayOfWeek: '週六',
        startTime: '14:00',
        endTime: '15:30',
        title: '成人優雅芭蕾美姿體雕班',
        venueName: '敦南日光舞蹈排練室 A 廳',
        venueCost: 2000,
        feePerStudent: 500,
        maxCapacity: 10,
        minThreshold: 4,
        status: 'scheduled'
      },
      {
        id: 'session-prev',
        date: '2026-09-12',
        dayOfWeek: '週六',
        startTime: '14:00',
        endTime: '15:30',
        title: '成人優雅芭蕾美姿體雕班',
        venueName: '敦南日光舞蹈排練室 A 廳',
        venueCost: 2000,
        feePerStudent: 500,
        maxCapacity: 10,
        minThreshold: 4,
        status: 'completed'
      }
    ];

    // 初始出勤展示：
    // stu-1 陳秀琴: 已手寫簽名簽到
    // stu-2 王美玲: 已在 24h 前請假 (保留堂數)
    // 其餘學員: registered (預約應到，待 iPad 現場手寫簽到)
    const sampleSignatureSvg = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="80"><path d="M20,50 Q60,10 90,45 T170,30" fill="none" stroke="%231a365d" stroke-width="4" stroke-linecap="round"/></svg>';

    const initialAttendance: AttendanceRecord[] = [
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
      }
    ];

    this.students.set(initialStudents);
    this.ticketPacks.set(initialPacks);
    this.sessions.set(initialSessions);
    this.attendance.set(initialAttendance);
    this.selectedSessionId.set('session-upcoming');
    this.selectedStudentId.set('stu-1');
    this.simulationHoursUntilClass.set(30);
  }
}
