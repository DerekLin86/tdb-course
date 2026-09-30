import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting, HttpTestingController } from '@angular/common/http/testing';
import { BalletApiService, BALLET_API_BASE_URL } from './ballet-api.service';
import { StudentWithActivePack, TicketPack } from '../types/student.type';
import { ClassSession, AttendanceRecord, SessionFinancialStats } from '../types/attendance.type';
import {
  CheckInResponse,
  LeaveResponse,
  CancelLeaveResponse,
  CancelThresholdResponse,
  SystemResetResponse,
} from '../types/api.type';

describe('BalletApiService', () => {
  let service: BalletApiService;
  let httpMock: HttpTestingController;
  const baseUrl = 'http://localhost:8000/api/v1';

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        BalletApiService,
      ]
    });
    service = TestBed.inject(BalletApiService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('應正確建立服務並標記 isAvailable 為 true', () => {
    expect(service).toBeTruthy();
    expect(service.isAvailable).toBeTrue();
    expect(service.baseUrl).toBe(baseUrl);
  });

  describe('Students & Ticket Packs Endpoints', () => {
    it('getStudents() 應發送 GET 請求至 /students', () => {
      const mockStudents: StudentWithActivePack[] = [
        { id: 'stu-1', name: '陳秀琴', phone: '0912-345-678', registeredAt: '2025-01-10' }
      ];

      service.getStudents().subscribe(students => {
        expect(students).toEqual(mockStudents);
      });

      const req = httpMock.expectOne(`${baseUrl}/students`);
      expect(req.request.method).toBe('GET');
      req.flush(mockStudents);
    });

    it('createStudent() 應發送 POST 請求至 /students', () => {
      const payload = { name: '林秋月', phone: '0934-567-890' };
      const mockResponse: StudentWithActivePack = {
        id: 'stu-new',
        name: '林秋月',
        phone: '0934-567-890',
        registeredAt: '2026-09-18'
      };

      service.createStudent(payload).subscribe(res => {
        expect(res).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${baseUrl}/students`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(payload);
      req.flush(mockResponse);
    });

    it('getStudentById() 應發送 GET 請求至 /students/{id}', () => {
      const mockStudent: StudentWithActivePack = {
        id: 'stu-1',
        name: '陳秀琴',
        phone: '0912-345-678',
        registeredAt: '2025-01-10'
      };

      service.getStudentById('stu-1').subscribe(res => {
        expect(res).toEqual(mockStudent);
      });

      const req = httpMock.expectOne(`${baseUrl}/students/stu-1`);
      expect(req.request.method).toBe('GET');
      req.flush(mockStudent);
    });

    it('purchaseTicketPack() 應發送 POST 請求至 /ticket-packs', () => {
      const payload = {
        studentId: 'stu-1',
        type: '10_class' as const,
        totalCount: 10,
        validityDays: 100,
        pricePaid: 5000
      };
      const mockPack: TicketPack = {
        id: 'pack-new',
        studentId: 'stu-1',
        type: '10_class',
        totalCount: 10,
        remainingCount: 10,
        purchaseDate: '2026-09-18',
        expiryDate: '2026-12-27',
        status: 'active',
        pricePaid: 5000
      };

      service.purchaseTicketPack(payload).subscribe(res => {
        expect(res).toEqual(mockPack);
      });

      const req = httpMock.expectOne(`${baseUrl}/ticket-packs`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual(payload);
      req.flush(mockPack);
    });

    it('extendTicketPack() 應發送 PATCH 請求至 /ticket-packs/{id}/extend', () => {
      const mockPack: TicketPack = {
        id: 'pack-1',
        studentId: 'stu-1',
        type: '10_class',
        totalCount: 10,
        remainingCount: 7,
        purchaseDate: '2026-08-01',
        expiryDate: '2026-12-15',
        status: 'active'
      };

      service.extendTicketPack('pack-1', 30).subscribe(res => {
        expect(res).toEqual(mockPack);
      });

      const req = httpMock.expectOne(`${baseUrl}/ticket-packs/pack-1/extend`);
      expect(req.request.method).toBe('PATCH');
      expect(req.request.body).toEqual({ extraDays: 30 });
      req.flush(mockPack);
    });
  });

  describe('Class Sessions & Financials Endpoints', () => {
    it('getSessions() 應發送 GET 請求至 /sessions', () => {
      const mockSessions: ClassSession[] = [
        {
          id: 'session-upcoming',
          date: '2026-09-19',
          dayOfWeek: '週六',
          startTime: '14:00',
          endTime: '15:30',
          title: '成人優雅芭蕾美姿體雕班',
          venueName: '台北敦南教室 A 廳',
          venueCost: 2000,
          feePerStudent: 500,
          maxCapacity: 10,
          minThreshold: 4,
          status: 'scheduled'
        }
      ];

      service.getSessions().subscribe(sessions => {
        expect(sessions).toEqual(mockSessions);
      });

      const req = httpMock.expectOne(`${baseUrl}/sessions`);
      expect(req.request.method).toBe('GET');
      req.flush(mockSessions);
    });

    it('getSession() 應發送 GET 請求至 /sessions/{id}', () => {
      const mockSession: ClassSession = {
        id: 'session-upcoming',
        date: '2026-09-19',
        dayOfWeek: '週六',
        startTime: '14:00',
        endTime: '15:30',
        title: '成人優雅芭蕾美姿體雕班',
        venueName: '台北敦南教室 A 廳',
        venueCost: 2000,
        feePerStudent: 500,
        maxCapacity: 10,
        minThreshold: 4,
        status: 'scheduled'
      };

      service.getSession('session-upcoming').subscribe(res => {
        expect(res).toEqual(mockSession);
      });

      const req = httpMock.expectOne(`${baseUrl}/sessions/session-upcoming`);
      expect(req.request.method).toBe('GET');
      req.flush(mockSession);
    });

    it('getSessionFinancials() 應發送 GET 請求至 /sessions/{id}/financials', () => {
      const mockStats: SessionFinancialStats = {
        totalCapacity: 10,
        expectedAttendees: 5,
        actualAttendedCount: 4,
        advanceLeaveCount: 1,
        lateLeaveCount: 0,
        absentCount: 0,
        minThreshold: 4,
        isAtRisk: false,
        effectiveRevenue: 2500,
        venueCost: 2000,
        teacherFee: 1200,
        otherCost: 0,
        totalCost: 3200,
        estimatedNetProfit: 500,
        breakEvenAttendees: 7
      };

      service.getSessionFinancials('session-upcoming').subscribe(stats => {
        expect(stats).toEqual(mockStats);
      });

      const req = httpMock.expectOne(`${baseUrl}/sessions/session-upcoming/financials`);
      expect(req.request.method).toBe('GET');
      req.flush(mockStats);
    });

    it('cancelSessionDueToThreshold() 應發送 POST 請求至 /sessions/{id}/cancel-threshold', () => {
      const mockResponse: CancelThresholdResponse = {
        message: '課堂已成功取消，共退還 2 堂扣額',
        refundedCount: 2
      };

      service.cancelSessionDueToThreshold('session-upcoming', '人數不足').subscribe(res => {
        expect(res).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${baseUrl}/sessions/session-upcoming/cancel-threshold`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ reason: '人數不足' });
      req.flush(mockResponse);
    });
  });

  describe('Attendance & Mode A Check-in Endpoints', () => {
    it('getSessionAttendance() 應發送 GET 請求至 /sessions/{id}/attendance', () => {
      const mockAttendance: AttendanceRecord[] = [
        {
          id: 'att-1',
          sessionId: 'session-upcoming',
          studentId: 'stu-1',
          studentName: '陳秀琴',
          status: 'attended',
          deductedCount: 1
        }
      ];

      service.getSessionAttendance('session-upcoming').subscribe(records => {
        expect(records).toEqual(mockAttendance);
      });

      const req = httpMock.expectOne(`${baseUrl}/sessions/session-upcoming/attendance`);
      expect(req.request.method).toBe('GET');
      req.flush(mockAttendance);
    });

    it('checkIn() 應發送 POST 請求至 /sessions/{id}/check-in', () => {
      const signatureDataUrl = 'data:image/png;base64,mockSignature';
      const mockResponse: CheckInResponse = {
        success: true,
        message: '簽到成功',
        record: {
          id: 'att-1',
          sessionId: 'session-upcoming',
          studentId: 'stu-1',
          studentName: '陳秀琴',
          status: 'attended',
          deductedCount: 1,
          signatureDataUrl
        }
      };

      service.checkIn('session-upcoming', 'stu-1', signatureDataUrl).subscribe(res => {
        expect(res).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${baseUrl}/sessions/session-upcoming/check-in`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        studentId: 'stu-1',
        signatureDataUrl
      });
      req.flush(mockResponse);
    });

    it('requestLeave() 應發送 POST 請求至 /sessions/{id}/leave', () => {
      const mockResponse: LeaveResponse = {
        success: true,
        message: '已提前請假',
        isAdvance: true,
        deductedCount: 0,
        record: {
          id: 'att-2',
          sessionId: 'session-upcoming',
          studentId: 'stu-2',
          studentName: '王美玲',
          status: 'leave_advance',
          deductedCount: 0
        }
      };

      service.requestLeave('session-upcoming', 'stu-2', '家族聚餐', 36).subscribe(res => {
        expect(res).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${baseUrl}/sessions/session-upcoming/leave`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({
        studentId: 'stu-2',
        leaveReason: '家族聚餐',
        simulationHours: 36
      });
      req.flush(mockResponse);
    });

    it('cancelLeave() 應發送 POST 請求至 /sessions/{id}/cancel-leave', () => {
      const mockResponse: CancelLeaveResponse = {
        success: true,
        message: '請假已取消，預約已恢復',
        refunded: true
      };

      service.cancelLeave('session-upcoming', 'stu-2').subscribe(res => {
        expect(res).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${baseUrl}/sessions/session-upcoming/cancel-leave`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({ studentId: 'stu-2' });
      req.flush(mockResponse);
    });

    it('updateAttendanceStatus() 應發送 PUT 請求至 /sessions/{id}/attendance/{studentId}', () => {
      const mockRecord: AttendanceRecord = {
        id: 'att-3',
        sessionId: 'session-upcoming',
        studentId: 'stu-3',
        studentName: '林秋月',
        status: 'attended',
        deductedCount: 1,
        remark: '老師手動變更'
      };

      service.updateAttendanceStatus('session-upcoming', 'stu-3', 'attended', '老師手動變更').subscribe(res => {
        expect(res).toEqual(mockRecord);
      });

      const req = httpMock.expectOne(`${baseUrl}/sessions/session-upcoming/attendance/stu-3`);
      expect(req.request.method).toBe('PUT');
      expect(req.request.body).toEqual({
        status: 'attended',
        remark: '老師手動變更'
      });
      req.flush(mockRecord);
    });
  });

  describe('System Utility Endpoints', () => {
    it('resetSystem() 應發送 POST 請求至 /system/reset', () => {
      const mockResponse: SystemResetResponse = {
        message: '系統資料已成功重置為初始示範狀態',
        studentsCount: 10,
        ticketPacksCount: 10,
        sessionsCount: 2,
        attendanceCount: 2
      };

      service.resetSystem().subscribe(res => {
        expect(res).toEqual(mockResponse);
      });

      const req = httpMock.expectOne(`${baseUrl}/system/reset`);
      expect(req.request.method).toBe('POST');
      expect(req.request.body).toEqual({});
      req.flush(mockResponse);
    });
  });
});

describe('BalletApiService (HttpClient 未注入時)', () => {
  let service: BalletApiService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        BalletApiService,
      ]
    });
    service = TestBed.inject(BalletApiService);
  });

  it('當 HttpClient 未提供時，isAvailable 應為 false', () => {
    expect(service.isAvailable).toBeFalse();
  });

  it('當 HttpClient 未提供時，唯讀查詢回傳空陣列 Observable', (done) => {
    service.getStudents().subscribe(students => {
      expect(students).toEqual([]);
      done();
    });
  });
});
