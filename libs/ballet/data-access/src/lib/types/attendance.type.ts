export type AttendanceStatus =
  | 'registered'      // 預約應到
  | 'attended'        // 已簽名出席 (扣 1 堂)
  | 'leave_advance'   // 24h前提前請假 (不扣堂)
  | 'leave_late'      // 24h內逾期請假 (扣 1 堂防虧損)
  | 'absent';         // 缺席未到 (扣 1 堂)

export interface ClassSession {
  id: string;
  date: string;       // YYYY-MM-DD
  dayOfWeek: string;  // e.g. 週六
  startTime: string;  // 14:00
  endTime: string;    // 15:30
  title: string;      // e.g. 成人芭蕾基礎體雕班
  venueName: string;  // e.g. 台北敦南教室 A 廳
  venueCost: number;  // 場租成本，例如 2000
  feePerStudent: number; // 每堂學費折合，例如 500
  maxCapacity: number;   // 10
  minThreshold: number;  // 損益平衡門檻，預設 4
  status: 'scheduled' | 'completed' | 'cancelled';
  cancellationReason?: string;
}

export interface CreateClassSessionParams {
  title: string;
  date: string;       // YYYY-MM-DD
  dayOfWeek?: string; // e.g. 週六 (未指定則自動根據日期計算)
  startTime: string;  // 14:00
  endTime: string;    // 15:30
  venueName: string;  // e.g. 台北敦南教室 A 廳
  venueCost?: number; // 場租成本，預設 2000
  feePerStudent?: number; // 每堂學費折合，預設 500
  maxCapacity?: number;   // 滿班人數，預設 10
  minThreshold?: number;  // 損益防護門檻，預設 4
}
export interface AttendanceRecord {
  id: string;
  sessionId: string;
  studentId: string;
  studentName: string;
  status: AttendanceStatus;
  signatureDataUrl?: string; // 手寫簽名 Base64 圖檔
  signedAt?: string;          // 簽到時間 HH:mm:ss
  deductedCount: number;      // 0 或 1
  leaveRequestedAt?: string;  // 請假提出時間
  leaveReason?: string;
  remark?: string;
}

export interface StudentAttendanceHistoryItem {
  record: AttendanceRecord;
  session?: ClassSession;
}

export interface SessionFinancialStats {
  totalCapacity: number;
  expectedAttendees: number; // registered + attended
  actualAttendedCount: number;
  advanceLeaveCount: number;
  lateLeaveCount: number;
  absentCount: number;
  minThreshold: number;
  isAtRisk: boolean; // 人數小於最低開班門檻
  effectiveRevenue: number; // (attended + lateLeave + absent) * feePerStudent
  venueCost: number;
  estimatedNetProfit: number;
}
