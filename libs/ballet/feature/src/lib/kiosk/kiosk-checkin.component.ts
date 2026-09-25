import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BalletStateService, Student } from '@libs/ballet/data-access';
import { SignaturePadComponent } from '@libs/shared/ui';

@Component({
  selector: 'app-kiosk-checkin',
  standalone: true,
  imports: [CommonModule, SignaturePadComponent],
  templateUrl: './kiosk-checkin.component.html',
  styleUrls: ['./kiosk-checkin.component.scss']
})
export class KioskCheckinComponent {
  readonly state = inject(BalletStateService);

  readonly session = this.state.currentSession;
  readonly attendanceList = this.state.currentSessionAttendance;
  readonly financials = this.state.currentSessionFinancials;

  // 可供簽到的課堂列表（排除已取消課堂，並依日期與開始時間升冪排序）
  readonly availableSessions = computed(() => {
    return this.state
      .sessions()
      .filter((s) => s.status !== 'cancelled')
      .slice()
      .sort((a, b) => {
        const dateDiff = a.date.localeCompare(b.date);
        if (dateDiff !== 0) return dateDiff;
        return a.startTime.localeCompare(b.startTime);
      });
  });

  // 簽名彈窗控制 Signal
  readonly activeStudentForSigning = signal<{
    student: Student;
    remainingCount: number;
  } | null>(null);

  // 簽到成功祝賀 Toast
  readonly toastMessage = signal<string | null>(null);

  // 切換選取的課堂
  onSessionChange(event: Event): void {
    const select = event.target as HTMLSelectElement | null;
    if (!select || !select.value) return;

    // 若正開啟簽名視窗，切換課堂時重設，避免誤簽到舊課堂上下文
    this.closeSignModal();
    this.state.setSelectedSession(select.value);
  }

  // 點擊學員卡片
  openSignModal(item: any): void {
    if (item.status === 'attended') {
      // 已經簽到了，不重複觸發
      return;
    }
    if (item.status === 'leave_advance' || item.status === 'leave_late') {
      alert(`${item.student.name} 今日已登記請假囉！如需改為補課出席，請由老師於後台協助變更。`);
      return;
    }

    const remaining = item.activePack?.remainingCount ?? 0;
    if (remaining <= 0) {
      alert(`${item.student.name} 的票卡堂數已用完，請先洽老師加購票卡！`);
      return;
    }

    this.activeStudentForSigning.set({
      student: item.student,
      remainingCount: remaining
    });
  }

  closeSignModal(): void {
    this.activeStudentForSigning.set(null);
  }

  handleSignatureSaved(dataUrl: string): void {
    const signingStudent = this.activeStudentForSigning();
    if (!signingStudent) return;

    const res = this.state.checkInWithSignature(signingStudent.student.id, dataUrl);
    this.closeSignModal();

    if (res.success) {
      this.showToast(res.message);
    } else {
      alert(res.message);
    }
  }

  private showToast(msg: string): void {
    this.toastMessage.set(msg);
    setTimeout(() => {
      this.toastMessage.set(null);
    }, 4000);
  }
}
