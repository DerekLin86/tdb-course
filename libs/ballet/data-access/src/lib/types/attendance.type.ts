export type AttendanceStatus =
  | 'registered'      // 預約應到
  | 'attended'        // 已簽名出席 (扣 1 堂)
  | 'leave_advance'   // 24h前提前請假 (不扣堂)
  | 'leave_late'      // 24h內逾期請假 (扣 1 堂防虧損)
  | 'absent';         // 缺席未到 (扣 1 堂)

export interface Course {
  id: string;
  title: string;              // e.g. 成人優雅芭蕾美姿體雕班 (秋季初階期班)
  description: string;
  totalSessions: number;      // 全期總堂數，例如 8 堂
  defaultVenueCost: number;   // 預設每堂場租成本，例如 2000
  defaultTeacherFee: number;  // 預設每堂師資鐘點費，例如 1200
  defaultFeePerStudent: number; // 預設每堂學費折合，例如 500
  minThreshold: number;       // 最低開班門檻人數，例如 4
  status: 'active' | 'completed' | 'archived';
  startDate?: string;
  endDate?: string;
}

export interface CreateCourseParams {
  title: string;
  description?: string;
  totalSessions: number;
  defaultVenueCost?: number;
  defaultTeacherFee?: number;
  defaultFeePerStudent?: number;
  minThreshold?: number;
  startDate?: string;
  endDate?: string;
}

export interface ClassSession {
  id: string;
  courseId?: string;     // 所屬期班課程 ID
  sessionIndex?: number; // 課堂堂數序號 (例如第 1 堂、第 2 堂)
  date: string;          // YYYY-MM-DD
  dayOfWeek: string;     // e.g. 週六
  startTime: string;     // 14:00
  endTime: string;       // 15:30
  title?: string;        // e.g. 成人芭蕾基礎體雕班 (第 2 堂)
  venueName: string;     // e.g. 台北敦南教室 A 廳
  venueCost: number;     // 場租成本，例如 2000
  teacherFee?: number;   // 師資鐘點費成本，例如 1200
  otherCost?: number;    // 其他行政雜支，例如 0
  feePerStudent: number; // 每堂學費折合，例如 500
  maxCapacity: number;   // 10
  minThreshold: number;  // 損益防護開班門檻，預設 4
  status: 'scheduled' | 'completed' | 'cancelled';
  cancellationReason?: string;
}

export interface CreateClassSessionParams {
  courseId?: string;     // 所屬期班課程 ID
  sessionIndex?: number; // 堂數序號
  title?: string;
  date: string;          // YYYY-MM-DD
  dayOfWeek?: string;    // e.g. 週六 (未指定則自動根據日期計算)
  startTime: string;     // 14:00
  endTime: string;       // 15:30
  venueName: string;     // e.g. 台北敦南教室 A 廳
  venueCost?: number;    // 場租成本，預設 2000
  teacherFee?: number;   // 師資鐘點費，預設 1200
  otherCost?: number;    // 其他雜支成本，預設 0
  feePerStudent?: number;// 每堂學費折合，預設 500
  maxCapacity?: number;  // 滿班人數，預設 10
  minThreshold?: number; // 損益防護門檻，預設 4
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

// 單堂課財務與損益防護指標
export interface SessionFinancialStats {
  totalCapacity: number;
  expectedAttendees: number;   // registered + attended
  actualAttendedCount: number;
  advanceLeaveCount: number;
  lateLeaveCount: number;
  absentCount: number;
  minThreshold: number;
  isAtRisk: boolean;           // 人數小於最低門檻或損益平衡點
  effectiveRevenue: number;    // (attended + lateLeave + absent + registered) * feePerStudent
  venueCost: number;           // 場租成本
  teacherFee: number;          // 師資鐘點費
  otherCost: number;           // 其他雜支成本
  totalCost: number;           // venueCost + teacherFee + otherCost
  estimatedNetProfit: number;  // effectiveRevenue - totalCost
  breakEvenAttendees: number;  // 損益平衡門檻人數 Math.ceil(totalCost / feePerStudent)
}

// 全期課程總體財務與營運統計
export interface CourseFinancialStats {
  courseId: string;
  courseTitle: string;
  totalSessions: number;
  completedSessions: number;
  scheduledSessions: number;
  totalVenueCost: number;
  totalTeacherFee: number;
  totalOtherCost: number;
  totalCost: number;
  totalRevenue: number;
  accumulatedNetProfit: number;
  averageAttendanceRate: number; // 全期平均出席率 (百分比 0 ~ 100)
}

// 學員在該課程各堂課出勤與進度明細
export interface StudentCourseSessionDetail {
  sessionId: string;
  sessionIndex: number;
  date: string;
  status: AttendanceStatus | 'unregistered';
  signedAt?: string;
}

// 學員在該課程的累積進度與出勤率
export interface StudentCourseProgress {
  studentId: string;
  studentName: string;
  attendedCount: number;
  leaveCount: number;
  absentCount: number;
  registeredCount: number;
  totalCourseSessions: number;
  attendanceRate: number; // 出席率百分比 (0 ~ 100)
  sessionDetails: StudentCourseSessionDetail[];
}
