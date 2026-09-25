import { ComponentFixture, TestBed } from '@angular/core/testing';
import { KioskCheckinComponent } from './kiosk-checkin.component';
import { BalletStateService } from '@libs/ballet/data-access';

describe('KioskCheckinComponent', () => {
  let component: KioskCheckinComponent;
  let fixture: ComponentFixture<KioskCheckinComponent>;
  let stateService: BalletStateService;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [KioskCheckinComponent],
      providers: [BalletStateService]
    }).compileComponents();

    stateService = TestBed.inject(BalletStateService);
    stateService.resetMockData();

    fixture = TestBed.createComponent(KioskCheckinComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it('應成功建立元件並預設選取當前課堂', () => {
    expect(component).toBeTruthy();
    expect(component.session()).toBeTruthy();
    expect(component.session().id).toBe('session-upcoming');
  });

  it('availableSessions 應過濾排除已取消課堂並按日期時間升冪排序', () => {
    // 新增一筆已取消課堂
    stateService.sessions.set([
      ...stateService.sessions(),
      {
        id: 'session-cancelled',
        date: '2026-09-26',
        dayOfWeek: '週六',
        startTime: '10:00',
        endTime: '11:30',
        title: '已取消的早班課堂',
        venueName: '敦南日光舞蹈排練室 A 廳',
        venueCost: 2000,
        feePerStudent: 500,
        maxCapacity: 10,
        minThreshold: 4,
        status: 'cancelled'
      }
    ]);

    const available = component.availableSessions();
    expect(available.some((s) => s.id === 'session-cancelled')).toBeFalse();
    expect(available.length).toBeGreaterThanOrEqual(1);

    // 檢查日期時段排序
    for (let i = 0; i < available.length - 1; i++) {
      const curr = available[i].date + available[i].startTime;
      const next = available[i + 1].date + available[i + 1].startTime;
      expect(curr.localeCompare(next)).toBeLessThanOrEqual(0);
    }
  });

  it('切換課堂時應更新 BalletStateService.selectedSessionId 並連動學員名冊', () => {
    // 預設 session-upcoming 有 stu-1, stu-2 等學員
    expect(component.attendanceList().length).toBeGreaterThan(0);

    // 模擬觸發 onSessionChange 切換至 session-prev
    const mockEvent = {
      target: {
        value: 'session-prev'
      }
    } as unknown as Event;

    component.onSessionChange(mockEvent);
    fixture.detectChanges();

    expect(stateService.selectedSessionId()).toBe('session-prev');
    expect(component.session().id).toBe('session-prev');
  });

  it('切換課堂時應關閉開啟中的簽名彈窗', () => {
    component.activeStudentForSigning.set({
      student: {
        id: 'stu-1',
        name: '陳秀琴',
        phone: '0912-345-678',
        registeredAt: '2025-01-10'
      },
      remainingCount: 7
    });
    expect(component.activeStudentForSigning()).toBeTruthy();

    const mockEvent = {
      target: {
        value: 'session-prev'
      }
    } as unknown as Event;

    component.onSessionChange(mockEvent);
    expect(component.activeStudentForSigning()).toBeNull();
  });
});
