import { Injectable, InjectionToken, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { Student, StudentWithActivePack, TicketPack } from '../types/student.type';
import { AttendanceRecord, AttendanceStatus, ClassSession, SessionFinancialStats } from '../types/attendance.type';
import {
  CheckInResponse,
  LeaveResponse,
  CancelLeaveResponse,
  CancelThresholdResponse,
  TicketPackCreateRequest,
  SystemResetResponse,
} from '../types/api.type';

export const BALLET_API_BASE_URL = new InjectionToken<string>('BALLET_API_BASE_URL', {
  providedIn: 'root',
  factory: () => 'http://localhost:8000/api/v1'
});

@Injectable({
  providedIn: 'root'
})
export class BalletApiService {
  private readonly http = inject(HttpClient, { optional: true });
  readonly baseUrl = inject(BALLET_API_BASE_URL);

  get isAvailable(): boolean {
    return !!this.http;
  }

  // 1. Students & Ticket Packs
  getStudents(): Observable<StudentWithActivePack[]> {
    if (!this.http) return of([]);
    return this.http.get<StudentWithActivePack[]>(`${this.baseUrl}/students`);
  }

  createStudent(payload: Partial<Student>): Observable<StudentWithActivePack> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.post<StudentWithActivePack>(`${this.baseUrl}/students`, payload);
  }

  getStudentById(studentId: string): Observable<StudentWithActivePack> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.get<StudentWithActivePack>(`${this.baseUrl}/students/${studentId}`);
  }

  purchaseTicketPack(payload: TicketPackCreateRequest): Observable<TicketPack> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.post<TicketPack>(`${this.baseUrl}/ticket-packs`, payload);
  }

  extendTicketPack(packId: string, extraDays = 30): Observable<TicketPack> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.patch<TicketPack>(`${this.baseUrl}/ticket-packs/${packId}/extend`, { extraDays });
  }

  // 2. Class Sessions & Financials
  getSessions(): Observable<ClassSession[]> {
    if (!this.http) return of([]);
    return this.http.get<ClassSession[]>(`${this.baseUrl}/sessions`);
  }

  createSession(payload: Partial<ClassSession>): Observable<ClassSession> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.post<ClassSession>(`${this.baseUrl}/sessions`, payload);
  }

  getSession(sessionId: string): Observable<ClassSession> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.get<ClassSession>(`${this.baseUrl}/sessions/${sessionId}`);
  }

  getSessionFinancials(sessionId: string): Observable<SessionFinancialStats> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.get<SessionFinancialStats>(`${this.baseUrl}/sessions/${sessionId}/financials`);
  }

  cancelSessionDueToThreshold(sessionId: string, reason?: string): Observable<CancelThresholdResponse> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.post<CancelThresholdResponse>(`${this.baseUrl}/sessions/${sessionId}/cancel-threshold`, {
      reason: reason || '人數未達最低開班門檻（場租損益防護退租）'
    });
  }

  // 3. Attendance & Mode A Kiosk Check-in
  getSessionAttendance(sessionId: string): Observable<AttendanceRecord[]> {
    if (!this.http) return of([]);
    return this.http.get<AttendanceRecord[]>(`${this.baseUrl}/sessions/${sessionId}/attendance`);
  }

  checkIn(sessionId: string, studentId: string, signatureDataUrl: string): Observable<CheckInResponse> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.post<CheckInResponse>(`${this.baseUrl}/sessions/${sessionId}/check-in`, {
      studentId,
      signatureDataUrl
    });
  }

  requestLeave(
    sessionId: string,
    studentId: string,
    leaveReason?: string,
    simulationHours?: number
  ): Observable<LeaveResponse> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.post<LeaveResponse>(`${this.baseUrl}/sessions/${sessionId}/leave`, {
      studentId,
      leaveReason,
      simulationHours
    });
  }

  cancelLeave(sessionId: string, studentId: string): Observable<CancelLeaveResponse> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.post<CancelLeaveResponse>(`${this.baseUrl}/sessions/${sessionId}/cancel-leave`, {
      studentId
    });
  }

  updateAttendanceStatus(
    sessionId: string,
    studentId: string,
    status: AttendanceStatus,
    remark?: string
  ): Observable<AttendanceRecord> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.put<AttendanceRecord>(`${this.baseUrl}/sessions/${sessionId}/attendance/${studentId}`, {
      status,
      remark
    });
  }

  // 4. System Utility
  resetSystem(): Observable<SystemResetResponse> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.post<SystemResetResponse>(`${this.baseUrl}/system/reset`, {});
  }
}
