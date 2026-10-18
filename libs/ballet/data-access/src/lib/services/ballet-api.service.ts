import { Injectable, Optional, InjectionToken, Inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';

export const BALLET_API_BASE_URL = new InjectionToken<string>('BALLET_API_BASE_URL', {
  providedIn: 'root',
  factory: () => 'http://localhost:8000/api/v1'
});
import {
  Student,
  StudentWithActivePack,
  CreateStudentParams,
  UpdateStudentParams,
  TicketPack,
  PurchaseTicketPackParams,
  ExtendTicketPackParams,
  ClassSession,
  CreateClassSessionParams,
  AttendanceRecord,
  AttendanceStatus,
  SessionFinancialStats,
  Course,
  CreateCourseParams,
  CourseFinancialStats,
  CourseEnrollment,
  EnrollStudentInCourseRequest,
  DeleteCourseEnrollmentResponse,
  CancelThresholdResponse,
  CheckInResponse,
  LeaveResponse,
  CancelLeaveResponse,
  SystemResetResponse
} from '../types';

@Injectable({
  providedIn: 'root'
})
export class BalletApiService {
  readonly baseUrl: string;

  constructor(
    @Optional() private readonly http?: HttpClient,
    @Optional() @Inject(BALLET_API_BASE_URL) baseUrl?: string
  ) {
    this.baseUrl = baseUrl || 'http://localhost:8000/api/v1';
  }

  get isAvailable(): boolean {
    return !!this.http;
  }

  // 1. Students & Ticket Packs
  getStudents(): Observable<StudentWithActivePack[]> {
    if (!this.http) return of([]);
    return this.http.get<StudentWithActivePack[]>(`${this.baseUrl}/students`);
  }

  getStudentById(studentId: string): Observable<Student> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.get<Student>(`${this.baseUrl}/students/${studentId}`);
  }

  createStudent(payload: CreateStudentParams): Observable<Student> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.post<Student>(`${this.baseUrl}/students`, payload);
  }

  updateStudent(studentId: string, payload: UpdateStudentParams): Observable<Student> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.put<Student>(`${this.baseUrl}/students/${studentId}`, payload);
  }

  deleteStudent(studentId: string): Observable<{ success: boolean; message: string }> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.delete<{ success: boolean; message: string }>(`${this.baseUrl}/students/${studentId}`);
  }

  purchaseTicketPack(payload: PurchaseTicketPackParams): Observable<TicketPack> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.post<TicketPack>(`${this.baseUrl}/ticket-packs`, payload);
  }

  extendTicketPack(packId: string, payload: ExtendTicketPackParams | number = 30): Observable<TicketPack> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    const body = typeof payload === 'number' ? { extraDays: payload } : payload;
    return this.http.patch<TicketPack>(`${this.baseUrl}/ticket-packs/${packId}/extend`, body);
  }

  // 2. Class Sessions & Financials
  getSessions(): Observable<ClassSession[]> {
    if (!this.http) return of([]);
    return this.http.get<ClassSession[]>(`${this.baseUrl}/sessions`);
  }

  createSession(payload: CreateClassSessionParams): Observable<ClassSession> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.post<ClassSession>(`${this.baseUrl}/sessions`, payload);
  }

  getSessionById(sessionId: string): Observable<ClassSession> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.get<ClassSession>(`${this.baseUrl}/sessions/${sessionId}`);
  }

  getSession(sessionId: string): Observable<ClassSession> {
    return this.getSessionById(sessionId);
  }

  getSessionFinancials(sessionId: string): Observable<SessionFinancialStats> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.get<SessionFinancialStats>(`${this.baseUrl}/sessions/${sessionId}/financials`);
  }

  cancelSessionDueToThreshold(sessionId: string, reason?: string): Observable<CancelThresholdResponse> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.post<CancelThresholdResponse>(`${this.baseUrl}/sessions/${sessionId}/cancel-threshold`, {
      reason
    });
  }

  // 3. Attendance & Kiosk Check-In
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
    leaveReason: string,
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

  // Courses API
  getCourses(): Observable<Course[]> {
    if (!this.http) return of([]);
    return this.http.get<Course[]>(`${this.baseUrl}/courses`);
  }

  createCourse(payload: CreateCourseParams): Observable<Course> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.post<Course>(`${this.baseUrl}/courses`, payload);
  }

  getCourseById(courseId: string): Observable<Course> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.get<Course>(`${this.baseUrl}/courses/${courseId}`);
  }

  deleteCourse(courseId: string): Observable<{ success: boolean; message: string }> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.delete<{ success: boolean; message: string }>(`${this.baseUrl}/courses/${courseId}`);
  }

  getCourseStudents(courseId: string): Observable<CourseEnrollment[]> {
    if (!this.http) return of([]);
    return this.http.get<CourseEnrollment[]>(`${this.baseUrl}/courses/${courseId}/students`);
  }

  enrollStudentInCourse(courseId: string, payload: EnrollStudentInCourseRequest): Observable<CourseEnrollment> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.post<CourseEnrollment>(`${this.baseUrl}/courses/${courseId}/students`, payload);
  }

  removeStudentFromCourse(courseId: string, studentId: string): Observable<DeleteCourseEnrollmentResponse> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.delete<DeleteCourseEnrollmentResponse>(`${this.baseUrl}/courses/${courseId}/students/${studentId}`);
  }

  // 4. System Utility
  resetSystem(): Observable<SystemResetResponse> {
    if (!this.http) return throwError(() => new Error('HttpClient not available'));
    return this.http.post<SystemResetResponse>(`${this.baseUrl}/system/reset`, {});
  }
}
