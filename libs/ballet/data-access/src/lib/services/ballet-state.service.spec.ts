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

  it('【建立新課堂與選取】：應正確新增課堂、自動推算星期並切換當前課堂', () => {
    const initialCount = service.sessions().length;
    const newSession = service.createSession({
      title: '成人芭蕾足尖技巧進階班',
      date: '2026-10-03', // 2026-10-03 為週六
      startTime: '16:00',
      endTime: '17:30',
      venueName: '敦南日光舞蹈排練室 B 廳'
    });

    expect(service.sessions().length).toBe(initialCount + 1);
    expect(newSession.title).toBe('成人芭蕾足尖技巧進階班');
    expect(newSession.dayOfWeek).toBe('週六');
    expect(newSession.venueCost).toBe(2000);
    expect(newSession.minThreshold).toBe(4);
    expect(service.selectedSessionId()).toBe(newSession.id);
    expect(service.currentSession()?.id).toBe(newSession.id);

    // 切換回先前的課堂
    service.setSelectedSession('session-upcoming');
    expect(service.selectedSessionId()).toBe('session-upcoming');
    expect(service.currentSession()?.id).toBe('session-upcoming');
  });

  it('建立新課堂時若未提供 title，應自動依期班名稱與堂數序號生成課堂標題', () => {
    const course = service.courses()[0];
    const existingCount = service.sessions().filter(s => s.courseId === course.id).length;
    const nextIndex = existingCount + 1;

    const newSession = service.createSession({
      courseId: course.id,
      date: '2026-10-10',
      startTime: '14:00',
      endTime: '15:30',
      venueName: '台北敦南教室 A 廳'
    });

    expect(newSession.title).toBe(`${course.title} (第 ${nextIndex} 堂)`);
    expect(newSession.sessionIndex).toBe(nextIndex);
  });

  it('建立新課堂時，不應自動匯入任何學員 (名冊初始為空)', () => {
    const newSession = service.createSession({
      title: '週四成人芭蕾新開班',
      date: '2026-10-08',
      startTime: '19:00',
      endTime: '20:30',
      venueName: '敦南日光舞蹈排練室 A 廳'
    });

    expect(service.currentSession()?.id).toBe(newSession.id);
    expect(service.currentSessionAttendance().length).toBe(0);
    expect(service.currentSessionFinancials().expectedAttendees).toBe(0);
  });

  it('老師可手動將學員加入新課堂名冊，並可自課堂名冊移出', () => {
    const newSession = service.createSession({
      title: '週四成人芭蕾新開班',
      date: '2026-10-08',
      startTime: '19:00',
      endTime: '20:30',
      venueName: '敦南日光舞蹈排練室 A 廳'
    });

    const enrolled = service.enrollStudentInSession(newSession.id, 'stu-1');
    expect(enrolled).toBeTruthy();
    expect(service.currentSessionAttendance().length).toBe(1);
    expect(service.currentSessionAttendance()[0].student.id).toBe('stu-1');

    service.removeStudentFromSession(newSession.id, 'stu-1');
    expect(service.currentSessionAttendance().length).toBe(0);
  });

  it('【學員增刪改】：應正確新增學員（含初始票卡）、編輯資料與刪除學員', () => {
    const initialStuCount = service.students().length;

    // 1. 新增學員（含 10 堂票卡）
    const newStu = service.addStudent({
      name: '李雅芬',
      phone: '0912-888-999',
      notes: '瑜珈練習多年',
      initialPackType: '10_class'
    });

    expect(service.students().length).toBe(initialStuCount + 1);
    expect(newStu.name).toBe('李雅芬');
    const pack = service.ticketPacks().find(p => p.studentId === newStu.id);
    expect(pack).toBeTruthy();
    expect(pack?.totalCount).toBe(10);
    expect(pack?.remainingCount).toBe(10);

    // 2. 編輯學員資料
    service.updateStudent(newStu.id, {
      name: '李雅芬 (進階班)',
      phone: '0912-888-999',
      notes: '核心力量佳'
    });
    const updated = service.students().find(s => s.id === newStu.id);
    expect(updated?.name).toBe('李雅芬 (進階班)');
    expect(updated?.notes).toBe('核心力量佳');

    // 3. 刪除學員
    service.deleteStudent(newStu.id);
    expect(service.students().some(s => s.id === newStu.id)).toBeFalse();
    expect(service.ticketPacks().some(p => p.studentId === newStu.id)).toBeFalse();
  });

  it('老師可建立全新學員並直接加入課堂名冊', () => {
    const session = service.createSession({
      title: '成人美姿週六班',
      date: '2026-10-03',
      startTime: '10:00',
      endTime: '11:30',
      venueName: '敦南教室'
    });

    const newStu = service.addStudent({
      name: '林雅婷',
      phone: '0977-888-999',
      notes: '完全零基礎',
      initialPackType: '10_class'
    });

    expect(service.students().some(s => s.id === newStu.id)).toBeTrue();

    service.enrollStudentInSession(session.id, newStu.id);
    service.setSelectedSession(session.id);

    const attendance = service.currentSessionAttendance();
    expect(attendance.length).toBe(1);
    expect(attendance[0].student.name).toBe('林雅婷');
    expect(attendance[0].activePack?.remainingCount).toBe(10);
  });

  describe('【體驗課方案管理 (Trial Ticket Pack)】', () => {
    it('購買體驗課應正確設定 1 堂課、14 天效期、NT$ 400 實付金額與 active 狀態', () => {
      const studentId = 'stu-1';
      // 先清除可能存在的舊 trial 卡
      service.ticketPacks.set(service.ticketPacks().filter(p => !(p.studentId === studentId && p.type === 'trial')));

      const result = service.addTicketPack(studentId, 'trial', 1, 14, 400);

      expect(result.success).toBeTrue();
      expect(result.pack).toBeTruthy();
      expect(result.pack?.type).toBe('trial');
      expect(result.pack?.totalCount).toBe(1);
      expect(result.pack?.remainingCount).toBe(1);
      expect(result.pack?.pricePaid).toBe(400);
      expect(result.pack?.status).toBe('active');

      // 驗證 14 天到期日
      const today = new Date();
      const expectedExpiry = new Date(today);
      expectedExpiry.setDate(today.getDate() + 14);
      const pad = (n: number) => String(n).padStart(2, '0');
      const expectedExpiryStr = `${expectedExpiry.getFullYear()}-${pad(expectedExpiry.getMonth() + 1)}-${pad(expectedExpiry.getDate())}`;
      expect(result.pack?.expiryDate).toBe(expectedExpiryStr);
    });

    it('每位學員終身限購 1 次體驗課，重複購買時應被拒絕並保留限制', () => {
      const studentId = 'stu-2';
      // 確保至少已有一次 trial 紀錄
      service.ticketPacks.set(service.ticketPacks().filter(p => !(p.studentId === studentId && p.type === 'trial')));

      const firstPurchase = service.addTicketPack(studentId, 'trial', 1, 14, 400);
      expect(firstPurchase.success).toBeTrue();
      expect(service.hasPurchasedTrial(studentId)).toBeTrue();

      // 再次嘗試加購體驗課
      const secondPurchase = service.addTicketPack(studentId, 'trial', 1, 14, 400);
      expect(secondPurchase.success).toBeFalse();
      expect(secondPurchase.message).toContain('終身限購 1 次體驗課');

      // 檢查票卡池中仍只有一張體驗課
      const trialPacks = service.ticketPacks().filter(p => p.studentId === studentId && p.type === 'trial');
      expect(trialPacks.length).toBe(1);
    });

    it('addStudent() 帶入 initialPackType: trial 時應自動開卡 1 堂、14 天、400 元體驗課', () => {
      const newStu = service.addStudent({
        name: '體驗課新學員',
        phone: '0966-123-456',
        notes: '初次體驗芭蕾',
        initialPackType: 'trial'
      });

      expect(service.hasPurchasedTrial(newStu.id)).toBeTrue();
      const pack = service.ticketPacks().find(p => p.studentId === newStu.id && p.type === 'trial');
      expect(pack).toBeTruthy();
      expect(pack?.totalCount).toBe(1);
      expect(pack?.remainingCount).toBe(1);
      expect(pack?.pricePaid).toBe(400);
      expect(pack?.status).toBe('active');
    });

    it('hasPurchasedTrial() 應對已購買過/歷史擁有體驗課的學員回傳 true，未購買者回傳 false', () => {
      const testStuId = 'stu-trial-check';
      expect(service.hasPurchasedTrial(testStuId)).toBeFalse();

      service.addTicketPack(testStuId, 'trial', 1, 14, 400);
      expect(service.hasPurchasedTrial(testStuId)).toBeTrue();

      // 即便票卡變成 expired 或 depleted，歷史記錄依然算購買過
      const packs = service.ticketPacks().map(p => {
        if (p.studentId === testStuId && p.type === 'trial') {
          return { ...p, status: 'depleted' as const, remainingCount: 0 };
        }
        return p;
      });
      service.ticketPacks.set(packs);

      expect(service.hasPurchasedTrial(testStuId)).toBeTrue();
    });

    it('【學員歷程查詢】：getStudentAttendanceHistory 應正確關聯課堂資訊並依時間降冪排列', () => {
      const studentId = 'stu-1';
      // 預設 mock 資料中 stu-1 有出席記錄
      const history = service.getStudentAttendanceHistory(studentId);

      expect(history).toBeTruthy();
      expect(history.length).toBeGreaterThanOrEqual(1);

      // 檢查每筆記錄皆屬於該學員
      for (const item of history) {
        expect(item.record.studentId).toBe(studentId);
        if (item.session) {
          expect(item.session.id).toBe(item.record.sessionId);
        }
      }

      // 新增跨日期的課堂與出席記錄測試降冪排序
      service.sessions.set([
        ...service.sessions(),
        {
          id: 'session-future-1',
          date: '2026-10-15',
          dayOfWeek: '週四',
          startTime: '19:00',
          endTime: '20:30',
          title: '芭蕾進階班',
          venueName: '敦南 B 廳',
          venueCost: 2000,
          feePerStudent: 500,
          maxCapacity: 10,
          minThreshold: 4,
          status: 'scheduled'
        }
      ]);
      service.attendance.set([
        ...service.attendance(),
        {
          id: 'att-future-1',
          sessionId: 'session-future-1',
          studentId: studentId,
          studentName: '陳秀琴',
          status: 'registered',
          deductedCount: 0
        }
      ]);

      const updatedHistory = service.getStudentAttendanceHistory(studentId);
      expect(updatedHistory[0].session?.id).toBe('session-future-1');
    });

    it('【學員票卡歷程】：getStudentTicketPacks 應回傳該學員所有票卡並依購買日期降冪排列', () => {
      const studentId = 'stu-2';
      // 先新增一張歷史票卡
      service.addTicketPack(studentId, '5_class', 5, 60);

      const packs = service.getStudentTicketPacks(studentId);
      expect(packs.length).toBeGreaterThanOrEqual(2);

      for (const p of packs) {
        expect(p.studentId).toBe(studentId);
      }

      for (let i = 0; i < packs.length - 1; i++) {
        expect(packs[i].purchaseDate.localeCompare(packs[i + 1].purchaseDate)).toBeGreaterThanOrEqual(0);
      }
    });

    it('【學員備註更新】：updateStudentNotes 應正確更新學員備註並持久化', () => {
      const studentId = 'stu-1';
      const newNotes = '曾有左膝十字韌帶舊傷，做 Grand Plié 時需放慢角度';

      service.updateStudentNotes(studentId, newNotes);

      const student = service.students().find(s => s.id === studentId);
      expect(student?.notes).toBe(newNotes);
    });
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
      'createSession',
      'createStudent',
      'updateStudent',
      'deleteStudent',
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
    mockApi.createSession.and.returnValue(of(mockSessions[0]));
    mockApi.createStudent.and.returnValue(of(mockStudents[0]));
    mockApi.updateStudent.and.returnValue(of(mockStudents[0]));
    mockApi.deleteStudent.and.returnValue(of({ message: '學員已刪除', success: true }));
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

  it('createSession() 應非同步呼叫後端 API createSession', () => {
    service.refreshFromBackend();
    const newSession = service.createSession({
      title: '遠端新開芭蕾班',
      date: '2026-10-10',
      startTime: '10:00',
      endTime: '11:30',
      venueName: '敦南日光舞蹈排練室 A 廳'
    });
    expect(mockApi.createSession).toHaveBeenCalledWith(jasmine.objectContaining({
      id: newSession.id,
      title: '遠端新開芭蕾班',
      date: '2026-10-10'
    }));
  });

  it('addStudent() 應非同步呼叫後端 API createStudent', () => {
    service.refreshFromBackend();
    const newStu = service.addStudent({
      name: '遠端新學員',
      phone: '0988-777-666',
      notes: '首次體驗'
    });
    expect(mockApi.createStudent).toHaveBeenCalledWith(jasmine.objectContaining({
      name: '遠端新學員',
      phone: '0988-777-666'
    }));
  });

  it('updateStudent() 應非同步呼叫後端 API updateStudent', () => {
    service.refreshFromBackend();
    service.updateStudent('stu-remote-1', {
      name: '遠端學員 (改名)',
      phone: '0900-111-222'
    });
    expect(mockApi.updateStudent).toHaveBeenCalledWith('stu-remote-1', jasmine.objectContaining({
      name: '遠端學員 (改名)'
    }));
  });

  it('deleteStudent() 應非同步呼叫後端 API deleteStudent', () => {
    service.refreshFromBackend();
    service.deleteStudent('stu-remote-1');
    expect(mockApi.deleteStudent).toHaveBeenCalledWith('stu-remote-1');
  });

  it('【體驗課方案】：儲值體驗課應為 1 堂、效期 14 天、費用 NT$ 400', () => {
    const studentId = 'stu-10'; // 鄭麗卿 (原無體驗課)
    // 清除該學員既有票卡以利單純驗證
    service.ticketPacks.set(service.ticketPacks().filter(p => p.studentId !== studentId));

    const result = service.addTicketPack(studentId, 'trial', 1, 14, 400);
    expect(result.success).toBeTrue();
    expect(result.pack).toBeTruthy();
    expect(result.pack!.type).toBe('trial');
    expect(result.pack!.totalCount).toBe(1);
    expect(result.pack!.remainingCount).toBe(1);
    expect(result.pack!.pricePaid).toBe(400);
    expect(result.pack!.status).toBe('active');

    // 驗證 14 天效期
    const today = new Date();
    const expectedExpiry = new Date(today);
    expectedExpiry.setDate(today.getDate() + 14);
    const pad = (n: number) => String(n).padStart(2, '0');
    const expectedStr = `${expectedExpiry.getFullYear()}-${pad(expectedExpiry.getMonth() + 1)}-${pad(expectedExpiry.getDate())}`;
    expect(result.pack!.expiryDate).toBe(expectedStr);
  });

  it('【終身限購 1 次防線】：已購買過體驗課之學員無法重複購買體驗課', () => {
    const studentId = 'stu-10';
    service.ticketPacks.set(service.ticketPacks().filter(p => p.studentId !== studentId));

    // 第一次購買體驗課：成功
    const firstResult = service.addTicketPack(studentId, 'trial', 1, 14, 400);
    expect(firstResult.success).toBeTrue();
    expect(service.hasPurchasedTrial(studentId)).toBeTrue();

    // 第二次購買體驗課：應被攔截
    const secondResult = service.addTicketPack(studentId, 'trial', 1, 14, 400);
    expect(secondResult.success).toBeFalse();
    expect(secondResult.message).toContain('終身限購 1 次');

    // 即使將該體驗課狀態標為 depleted，依然終身限購
    const packs = service.ticketPacks().map(p => {
      if (p.studentId === studentId && p.type === 'trial') {
        return { ...p, remainingCount: 0, status: 'depleted' as const };
      }
      return p;
    });
    service.ticketPacks.set(packs);

    const thirdResult = service.addTicketPack(studentId, 'trial', 1, 14, 400);
    expect(thirdResult.success).toBeFalse();
    expect(thirdResult.message).toContain('終身限購 1 次');
  });

  it('addStudent() 初始方案若為 trial 應自動建立體驗課票卡', () => {
    const student = service.addStudent({
      name: '體驗課新學員',
      phone: '0977-888-999',
      initialPackType: 'trial'
    });

    const pack = service.ticketPacks().find(p => p.studentId === student.id && p.type === 'trial');
    expect(pack).toBeTruthy();
    expect(pack!.totalCount).toBe(1);
    expect(pack!.remainingCount).toBe(1);
    expect(pack!.pricePaid).toBe(400);
    expect(service.hasPurchasedTrial(student.id)).toBeTrue();
  });

  it('hasPurchasedTrial() 應準確判斷學員是否曾購買過體驗課', () => {
    expect(service.hasPurchasedTrial('stu-1')).toBeFalse();
    service.addTicketPack('stu-1', 'trial', 1, 14, 400);
    expect(service.hasPurchasedTrial('stu-1')).toBeTrue();
  });
});

describe('【多堂課課程關聯、全期財務損益與學員出勤進度】', () => {
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

  it('應正確載入預設 2 個期班課程及各堂課關聯，並設定預設當前選定課程', () => {
    expect(service.courses().length).toBe(2);
    expect(service.selectedCourseId()).toBe('course-1');
    expect(service.currentCourse()).toBeTruthy();
    expect(service.currentCourse()?.id).toBe('course-1');
    expect(service.currentCourse()?.totalSessions).toBe(8);

    const sessions = service.currentCourseSessions();
    expect(sessions.length).toBe(3);
    for (const s of sessions) {
      expect(s.courseId).toBe('course-1');
    }
  });

  it('createCourse() 應成功建立新期班並切換為當前課程', () => {
    const initialCount = service.courses().length;
    const newCourse = service.createCourse({
      title: '成人足尖技巧專班 (冬季班)',
      description: '冬季進階特別訓練',
      totalSessions: 10,
      defaultVenueCost: 2500,
      defaultTeacherFee: 1500,
      defaultFeePerStudent: 600,
      minThreshold: 5
    });

    expect(service.courses().length).toBe(initialCount + 1);
    expect(newCourse.title).toBe('成人足尖技巧專班 (冬季班)');
    expect(newCourse.defaultVenueCost).toBe(2500);
    expect(newCourse.defaultTeacherFee).toBe(1500);
    expect(service.selectedCourseId()).toBe(newCourse.id);
    expect(service.currentCourse()?.id).toBe(newCourse.id);
  });

  it('addSessionToCourse() 應依期班預設成本與堂數序號建立課堂並與期班關聯', () => {
    const courseId = 'course-1';
    const newSession = service.addSessionToCourse(courseId, {
      date: '2026-10-03',
      startTime: '14:00',
      endTime: '15:30'
    });

    expect(newSession.courseId).toBe(courseId);
    expect(newSession.sessionIndex).toBe(4);
    expect(newSession.venueCost).toBe(2000);
    expect(newSession.teacherFee).toBe(1200);
    expect(newSession.feePerStudent).toBe(500);
    expect(newSession.minThreshold).toBe(4);
    expect(service.currentCourseSessions().some(s => s.id === newSession.id)).toBeTrue();
  });

  it('setSelectedCourse() 切換期班時應連動更新 currentCourse 與 currentCourseSessions，並優先選取尚未結束（scheduled）之課堂', () => {
    service.setSelectedCourse('course-2');
    expect(service.selectedCourseId()).toBe('course-2');
    expect(service.currentCourse()?.id).toBe('course-2');
    expect(service.currentCourse()?.title).toContain('足尖技巧進階班');

    const course2Sessions = service.currentCourseSessions();
    expect(course2Sessions.length).toBe(2);
    expect(service.currentSession()?.courseId).toBe('course-2');
    // course-2 第一堂課已完成 (completed)，第二堂課未結束 (scheduled)，應優先選取第二堂課
    expect(service.currentSession()?.id).toBe('session-course-2-2');
    expect(service.currentSession()?.status).toBe('scheduled');
  });

  it('setSelectedCourse() 當目標期班所有課堂皆非 scheduled 狀態時應回退選取第一堂課', () => {
    // 將 course-2 僅存的 scheduled 課堂改為 cancelled
    service.cancelSessionDueToThreshold('session-course-2-2');

    // 先切回 course-1
    service.setSelectedCourse('course-1');
    expect(service.selectedCourseId()).toBe('course-1');

    // 再切到 course-2，此時無 scheduled 課堂，應回退至第一堂課
    service.setSelectedCourse('course-2');
    expect(service.currentSession()?.id).toBe('session-course-2-1');
  });

  it('currentCourseFinancials 應準確匯總全期場租、師資鐘點費、總成本、總營收與累積淨結餘', () => {
    service.setSelectedCourse('course-1');
    const financials = service.currentCourseFinancials();

    expect(financials.courseId).toBe('course-1');
    expect(financials.totalSessions).toBe(8);
    expect(financials.completedSessions).toBe(1); // session-prev
    expect(financials.scheduledSessions).toBe(2); // session-upcoming, session-course-1-3

    // 成本驗證: 3堂課 * (2000場租 + 1200師資) = 9600
    expect(financials.totalVenueCost).toBe(6000);
    expect(financials.totalTeacherFee).toBe(3600);
    expect(financials.totalOtherCost).toBe(0);
    expect(financials.totalCost).toBe(9600);

    // 營收與結餘均應為正值
    expect(financials.totalRevenue).toBeGreaterThan(0);
    expect(financials.accumulatedNetProfit).toBe(financials.totalRevenue - financials.totalCost);
    expect(financials.averageAttendanceRate).toBeGreaterThanOrEqual(0);
    expect(financials.averageAttendanceRate).toBeLessThanOrEqual(100);
  });

  it('currentCourseStudentProgress 應精確追蹤學員在各堂課的出席狀態、出勤堂數與出勤率百分比', () => {
    service.setSelectedCourse('course-1');
    const progressList = service.currentCourseStudentProgress();

    expect(progressList.length).toBe(10);

    // stu-1 (陳秀琴) 在 session-prev 與 session-upcoming 皆出席
    const stu1Progress = progressList.find(p => p.studentId === 'stu-1');
    expect(stu1Progress).toBeTruthy();
    expect(stu1Progress!.attendedCount).toBe(2);
    expect(stu1Progress!.totalCourseSessions).toBe(8);
    expect(stu1Progress!.attendanceRate).toBe(25); // 2 / 8 * 100% = 25%
    expect(stu1Progress!.sessionDetails.length).toBe(3);

    // getStudentCourseProgress 單獨查詢亦應回傳一致結果
    const singleProgress = service.getStudentCourseProgress('stu-1', 'course-1');
    expect(singleProgress).toEqual(stu1Progress!);
  });

  it('課堂停課順延時，全期財務統計應排除已取消課堂之成本與營收，保障損益計算準確', () => {
    service.setSelectedCourse('course-1');
    const beforeStats = service.currentCourseFinancials();

    // 將 session-upcoming 順延停課 (退場租)
    service.cancelSessionDueToThreshold('session-upcoming');

    const afterStats = service.currentCourseFinancials();
    // 應少一堂課的場租與師資成本 (2000 + 1200 = 3200)
    expect(afterStats.totalCost).toBe(beforeStats.totalCost - 3200);
    expect(afterStats.totalVenueCost).toBe(beforeStats.totalVenueCost - 2000);
    expect(afterStats.totalTeacherFee).toBe(beforeStats.totalTeacherFee - 1200);
  });
});


