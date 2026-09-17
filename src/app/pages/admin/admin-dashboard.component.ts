import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BalletStateService } from '../../services/ballet-state.service';
import { AttendanceStatus } from '../../types/attendance.type';
import { StudentWithActivePack } from '../../types/student.type';

@Component({
  selector: 'app-admin-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './admin-dashboard.component.html',
  styleUrls: ['./admin-dashboard.component.scss']
})
export class AdminDashboardComponent {
  readonly Math = Math;
  readonly state = inject(BalletStateService);

  readonly session = this.state.currentSession;
  readonly financials = this.state.currentSessionFinancials;
  readonly attendanceList = this.state.currentSessionAttendance;
  readonly studentsWithPacks = this.state.studentsWithPacks;

  // 簽名放大查看彈窗
  readonly viewingSignature = signal<{
    name: string;
    time: string;
    imgUrl: string;
  } | null>(null);

  // 標籤頁切換
  readonly activeTab = signal<'attendance' | 'tickets'>('attendance');

  // 手動變更出勤狀態
  changeAttendance(studentId: string, status: AttendanceStatus): void {
    this.state.setStudentAttendanceStatus(studentId, status);
  }

  // 檢視放大簽名
  openSignatureModal(name: string, time: string, imgUrl?: string): void {
    if (!imgUrl) return;
    this.viewingSignature.set({ name, time, imgUrl });
  }

  closeSignatureModal(): void {
    this.viewingSignature.set(null);
  }

  // 開班門檻不足時一鍵取消順延
  handleCancelSession(): void {
    const s = this.session();
    if (!s) return;
    if (
      confirm(
        `⚠️ 確定要順延此課堂嗎？\n\n系統將自動取消本週課堂，並全數退還學員已扣除之堂數，保障教室場租不虧本。`
      )
    ) {
      this.state.cancelSessionDueToThreshold(s.id);
      alert('已成功取消並順延本週課堂，學員堂數均已保全！');
    }
  }

  // 儲值票卡
  handleAddPack(student: StudentWithActivePack, type: '5_class' | '10_class'): void {
    const count = type === '5_class' ? 5 : 10;
    const days = type === '5_class' ? 60 : 100;
    if (confirm(`確定為【${student.name}】儲值 ${count} 堂課票卡（效期 ${days} 天）嗎？`)) {
      this.state.addTicketPack(student.id, type, count, days);
      alert(`✅ 已為 ${student.name} 成功儲值 ${count} 堂！`);
    }
  }

  // 展延票卡效期
  handleExtendExpiry(student: StudentWithActivePack): void {
    if (!student.activePack) {
      alert('該學員目前沒有有效票卡');
      return;
    }
    if (confirm(`確定為【${student.name}】的票卡展延 30 天效期嗎？`)) {
      this.state.extendPackExpiry(student.activePack.id, 30);
      alert(`✅ 已為 ${student.name} 展延效期 30 天！`);
    }
  }
}
