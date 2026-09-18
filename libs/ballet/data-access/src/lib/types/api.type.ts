import { Student, TicketPack, TicketPackType } from './student.type';
import { AttendanceRecord, AttendanceStatus } from './attendance.type';

export interface CheckInRequest {
  studentId: string;
  signatureDataUrl: string;
}

export interface CheckInResponse {
  success: boolean;
  message: string;
  record: AttendanceRecord & {
    student?: Student;
    activePack?: TicketPack;
  };
}

export interface LeaveRequest {
  studentId: string;
  leaveReason?: string;
  simulationHours?: number;
}

export interface LeaveResponse {
  success: boolean;
  message: string;
  isAdvance: boolean;
  deductedCount: number;
  record: AttendanceRecord & {
    student?: Student;
    activePack?: TicketPack;
  };
}

export interface CancelLeaveRequest {
  studentId: string;
}

export interface CancelLeaveResponse {
  success: boolean;
  message: string;
  refunded: boolean;
}

export interface AttendanceUpdateRequest {
  status: AttendanceStatus;
  remark?: string;
}

export interface CancelThresholdRequest {
  reason?: string;
}

export interface CancelThresholdResponse {
  message: string;
  refundedCount: number;
}

export interface TicketPackCreateRequest {
  studentId: string;
  type: TicketPackType;
  totalCount: number;
  validityDays: number;
  pricePaid?: number;
}

export interface TicketPackExtendRequest {
  extraDays: number;
}

export interface SystemResetResponse {
  message: string;
  studentsCount: number;
  ticketPacksCount: number;
  sessionsCount: number;
  attendanceCount: number;
}
