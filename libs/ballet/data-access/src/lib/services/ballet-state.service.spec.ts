import { TestBed } from '@angular/core/testing';
import { BalletStateService } from './ballet-state.service';

describe('BalletStateService (防虧損與出缺勤業務邏輯測試)', () => {
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
