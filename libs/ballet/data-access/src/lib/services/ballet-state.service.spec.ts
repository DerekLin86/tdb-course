import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { BalletStateService } from './ballet-state.service';
import { BalletApiService } from './ballet-api.service';
import { StudentWithActivePack, TicketPack } from '../types/student.type';
import { ClassSession, AttendanceRecord } from '../types/attendance.type';

describe('BalletStateService (防虧損與出缺勤業務邏輯測試 - 單機無網路相容性)', () => {
  let service: BalletStateService;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({});
    service = TestBed.inject(BalletStateService);
    service.resetMockData();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('應正確載入預設 10 位學員與課程設定', () => {
    expect(service.students().length).toBe(10);
    expect(service.sessions().length).toBeGreaterThanOrEqual(1);
    expect(service.currentSession()).toBeTruthy();
    expect(service.currentSession()?.minThreshold).toBe(4);
  });

  it('【模式 A 手寫簽到】：簽到後應儲存簽名存根並扣抵 1 堂課', () => {
    const studentId = 'stu-3'; // 林秋月
    const initialPack = service.ticketPacks().find(p => p.studentId === studentId && p.status === 'active');
    const initialCount = initialPack!.remainingCount;

    const mockSignature = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const result = service.checkInWithSignature(studentId, mockSignature);

    expect(result.success).toBeTrue();

    // 檢查票卡扣除
    const updatedPack = service.ticketPacks().find(p => p.studentId === studentId && p.status === 'active');
    expect(updatedPack!.remainingCount).toBe(initialCount - 1);

    // 檢查出勤記錄與簽名
    const record = service.attendance().find(a => a.studentId === studentId && a.sessionId === service.currentSession()?.id);
    expect(record).toBeTruthy();
    expect(record!.status).toBe('attended');
    expect(record!.deductedCount).toBe(1);
    expect(record!.signatureDataUrl).toBe(mockSignature);
  });

  it('【防虧損防線一】：開課前 24 小時以上請假，堂數完整保留 (不扣堂)', () => {
    const studentId = 'stu-4'; // 張月霞
    const initialPack = service.ticketPacks().find(p => p.studentId === studentId && p.status === 'active');
    const initialCount = initialPack!.remainingCount;

    service.setSimulationHours(36); // 設定為距開課 36 小時前
    const result = service.requestLeave(studentId, '家族聚餐');

    expect(result.success).toBeTrue();
    expect(result.isAdvance).toBeTrue();

    // 堂數不應被扣除
    const updatedPack = service.ticketPacks().find(p => p.studentId === studentId && p.status === 'active');
    expect(updatedPack!.remainingCount).toBe(initialCount);

    // 出勤狀態為 leave_advance
    const record = service.attendance().find(a => a.studentId === studentId && a.sessionId === service.currentSession()?.id);
    expect(record!.status).toBe('leave_advance');
    expect(record!.deductedCount).toBe(0);
  });

  it('【防虧損防線二】：開課前 24 小時內逾期請假，依場租分攤規定扣抵 1 堂', () => {
    const studentId = 'stu-5'; // 許素貞
    const initialPack = service.ticketPacks().find(p => p.studentId === studentId && p.status === 'active');
    const initialCount = initialPack!.remainingCount;

    service.setSimulationHours(12); // 設定為距開課 12 小時前 (不足 24h)
    const result = service.requestLeave(studentId, '臨時有事');

    expect(result.success).toBeTrue();
    expect(result.isAdvance).toBeFalse();

    // 依規定扣除 1 堂
    const updatedPack = service.ticketPacks().find(p => p.studentId === studentId && p.status === 'active');
    expect(updatedPack!.remainingCount).toBe(initialCount - 1);

    // 出勤狀態為 leave_late
    const record = service.attendance().find(a => a.studentId === studentId && a.sessionId === service.currentSession()?.id);
    expect(record!.status).toBe('leave_late');
    expect(record!.deductedCount).toBe(1);
  });

  it('【防虧損防線三】：當出席人數低於最低開班門檻時，觸發損益警報', () => {
    service.setSimulationHours(36);

    // 讓 7 位學員提前請假，只剩 3 人出席 (低於門檻 4 人)
    const studentsToLeave = ['stu-3', 'stu-4', 'stu-5', 'stu-6', 'stu-7', 'stu-8', 'stu-9'];
    for (const sid of studentsToLeave) {
      service.requestLeave(sid);
    }

    const financials = service.currentSessionFinancials();
    expect(financials.expectedAttendees).toBeLessThan(financials.minThreshold);
    expect(financials.isAtRisk).toBeTrue();
    expect(financials.estimatedNetProfit).toBeLessThan(0); // 虧損狀態
  });

  it('【老師一鍵防虧退租】：開班未達門檻時順延課堂，全數歸還學員扣堂', () => {
    const sessionId = service.currentSession()!.id;
    service.setSimulationHours(12);

    // 某學生在 12h 內請假被扣了 1 堂
    service.requestLeave('stu-10');
    const packBefore = service.ticketPacks().find(p => p.studentId === 'stu-10')!;

    // 老師發現人數太少，決定順延本週以退租場地避免虧本
    service.cancelSessionDueToThreshold(sessionId);

    const cancelledSession = service.sessions().find(s => s.id === sessionId);
    expect(cancelledSession!.status).toBe('cancelled');

    // 被扣除的 1 堂應退還給學生
    const packAfter = service.ticketPacks().find(p => p.studentId === 'stu-10')!;
    expect(packAfter.remainingCount).toBe(packBefore.remainingCount + 1);
  });

  it('【票卡儲值與展延】：應正確新增票卡堂數與展延效期', () => {
    const studentId = 'stu-1';
    service.addTicketPack(studentId, '5_class', 5, 60);

    const packs = service.ticketPacks().filter(p => p.studentId === studentId);
    expect(packs.length).toBe(2);

    const latestPack = packs[packs.length - 1];
    expect(latestPack.remainingCount).toBe(5);

    // 展延 30 天
    const oldExpiry = latestPack.expiryDate;
    service.extendPackExpiry(latestPack.id, 30);
    const renewedPack = service.ticketPacks().find(p => p.id === latestPack.id);
    expect(renewedPack!.expiryDate).not.toBe(oldExpiry);
  });
});

describe('BalletStateService (後端 API 整合與非同步同步機制)', () => {
  let service: BalletStateService;
  let mockApi: jasmine.SpyObj<BalletApiService>;

  const mockStudents: StudentWithActivePack[] = [
    {
      id: 'stu-remote-1',
      name: '遠端學員1',
      phone: '0900-111-222',
      registeredAt: '2026-09-01',
      activePack: {
        id: 'pack-remote-1',
        studentId: 'stu-remote-1',
        type: '10_class',
        totalCount: 10,
        remainingCount: 8,
        purchaseDate: '2026-09-01',
        expiryDate: '2026-12-31',
        status: 'active'
      }
    }
  ];

  const mockSessions: ClassSession[] = [
    {
      id: 'session-remote-1',
      date: '2026-09-26',
      dayOfWeek: '週六',
      startTime: '14:00',
      endTime: '15:30',
      title: '遠端芭蕾課程',
      venueName: '遠端舞蹈廳',
      venueCost: 2000,
      feePerStudent: 500,
      maxCapacity: 10,
      minThreshold: 4,
      status: 'scheduled'
    }
  ];

  const mockAttendance: AttendanceRecord[] = [
    {
      id: 'att-remote-1',
      sessionId: 'session-remote-1',
      studentId: 'stu-remote-1',
      studentName: '遠端學員1',
      status: 'attended',
      deductedCount: 1
    }
  ];

  beforeEach(() => {
    localStorage.clear();

    mockApi = jasmine.createSpyObj<BalletApiService>('BalletApiService', [
      'getStudents',
      'getSessions',
      'getSessionAttendance',
      'checkIn',
      'requestLeave',
      'cancelLeave',
      'updateAttendanceStatus',
      'purchaseTicketPack',
      'extendTicketPack',
      'cancelSessionDueToThreshold',
      'resetSystem'
    ], {
      isAvailable: true,
      baseUrl: 'http://localhost:8000/api/v1'
    });

    mockApi.getStudents.and.returnValue(of(mockStudents));
    mockApi.getSessions.and.returnValue(of(mockSessions));
    mockApi.getSessionAttendance.and.returnValue(of(mockAttendance));
    mockApi.checkIn.and.returnValue(of({
      success: true,
      message: '簽到成功',
      record: mockAttendance[0]
    }));
    mockApi.requestLeave.and.returnValue(of({
      success: true,
      message: '請假成功',
      isAdvance: true,
      deductedCount: 0,
      record: { ...mockAttendance[0], status: 'leave_advance', deductedCount: 0 }
    }));
    mockApi.cancelLeave.and.returnValue(of({
      success: true,
      message: '取消請假成功',
      refunded: false
    }));
    mockApi.updateAttendanceStatus.and.returnValue(of(mockAttendance[0]));
    mockApi.purchaseTicketPack.and.returnValue(of(mockStudents[0].activePack!));
    mockApi.extendTicketPack.and.returnValue(of(mockStudents[0].activePack!));
    mockApi.cancelSessionDueToThreshold.and.returnValue(of({
      message: '課堂已取消',
      refundedCount: 1
    }));
    mockApi.resetSystem.and.returnValue(of({
      message: '重置完成',
      studentsCount: 10,
      ticketPacksCount: 10,
      sessionsCount: 2,
      attendanceCount: 2
    }));

    TestBed.configureTestingModule({
      providers: [
        { provide: BalletApiService, useValue: mockApi },
        BalletStateService
      ]
    });

    service = TestBed.inject(BalletStateService);
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('refreshFromBackend() 成功時應更新學生、課程與出勤狀態，並標記 isOnline 為 true', () => {
    service.refreshFromBackend();

    expect(mockApi.getStudents).toHaveBeenCalled();
    expect(mockApi.getSessions).toHaveBeenCalled();
    expect(service.isOnline()).toBeTrue();
    expect(service.isSyncing()).toBeFalse();
    expect(service.students().length).toBe(1);
    expect(service.students()[0].name).toBe('遠端學員1');
    expect(service.sessions()[0].title).toBe('遠端芭蕾課程');
    expect(service.ticketPacks().length).toBe(1);
  });

  it('refreshFromBackend() 失敗時應捕獲異常並切換為離線狀態，不破壞本地現有數據', () => {
    mockApi.getStudents.and.returnValue(throwError(() => new Error('連線拒絕')));

    service.refreshFromBackend();

    expect(service.isOnline()).toBeFalse();
    expect(service.isSyncing()).toBeFalse();
    expect(service.lastSyncError()).toContain('連線拒絕');
  });

  it('checkInWithSignature() 在本地樂觀更新後應非同步呼叫後端 API checkIn', () => {
    // 先讓 state 擁有遠端學員與課程
    service.refreshFromBackend();

    const result = service.checkInWithSignature('stu-remote-1', 'data:image/png;base64,mock');
    expect(result.success).toBeTrue();
    expect(mockApi.checkIn).toHaveBeenCalledWith('session-remote-1', 'stu-remote-1', 'data:image/png;base64,mock');
  });

  it('requestLeave() 在本地計算 24h 後應非同步呼叫後端 API requestLeave', () => {
    service.refreshFromBackend();
    service.setSimulationHours(36);

    const result = service.requestLeave('stu-remote-1', '個人事假');
    expect(result.success).toBeTrue();
    expect(result.isAdvance).toBeTrue();
    expect(mockApi.requestLeave).toHaveBeenCalledWith('session-remote-1', 'stu-remote-1', '個人事假', 36);
  });

  it('cancelLeave() 應非同步呼叫後端 API cancelLeave', () => {
    service.refreshFromBackend();
    service.cancelLeave('stu-remote-1');
    expect(mockApi.cancelLeave).toHaveBeenCalledWith('session-remote-1', 'stu-remote-1');
  });

  it('setStudentAttendanceStatus() 應非同步呼叫後端 API updateAttendanceStatus', () => {
    service.refreshFromBackend();
    service.setStudentAttendanceStatus('stu-remote-1', 'absent');
    expect(mockApi.updateAttendanceStatus).toHaveBeenCalledWith(
      'session-remote-1',
      'stu-remote-1',
      'absent',
      '老師後台手動變更'
    );
  });

  it('addTicketPack() 應非同步呼叫後端 API purchaseTicketPack', () => {
    service.refreshFromBackend();
    service.addTicketPack('stu-remote-1', '5_class', 5, 60);
    expect(mockApi.purchaseTicketPack).toHaveBeenCalledWith(jasmine.objectContaining({
      studentId: 'stu-remote-1',
      type: '5_class',
      totalCount: 5,
      validityDays: 60
    }));
  });

  it('extendPackExpiry() 應非同步呼叫後端 API extendTicketPack', () => {
    service.refreshFromBackend();
    service.extendPackExpiry('pack-remote-1', 30);
    expect(mockApi.extendTicketPack).toHaveBeenCalledWith('pack-remote-1', 30);
  });

  it('cancelSessionDueToThreshold() 應非同步呼叫後端 API cancelSessionDueToThreshold', () => {
    service.refreshFromBackend();
    service.cancelSessionDueToThreshold('session-remote-1');
    expect(mockApi.cancelSessionDueToThreshold).toHaveBeenCalledWith('session-remote-1');
  });

  it('resetMockData() 應呼叫後端 API resetSystem', () => {
    service.resetMockData();
    expect(mockApi.resetSystem).toHaveBeenCalled();
  });
});
