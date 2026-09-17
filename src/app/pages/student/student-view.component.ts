import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BalletStateService } from '../../services/ballet-state.service';

@Component({
  selector: 'app-student-view',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './student-view.component.html',
  styleUrls: ['./student-view.component.scss']
})
export class StudentViewComponent {
  readonly state = inject(BalletStateService);

  readonly allStudents = this.state.students;
  readonly selectedStudentId = this.state.selectedStudentId;
  readonly student = this.state.currentStudent;
  readonly pack = this.state.currentStudentPack;
  readonly session = this.state.currentSession;
  readonly studentRecord = this.state.currentStudentAttendanceRecord;
  readonly hoursUntilClass = this.state.simulationHoursUntilClass;

  // 二次確認請假彈窗
  readonly showLeaveConfirmModal = signal<boolean>(false);
  readonly leaveReasonInput = signal<string>('個人私事請假');
  readonly toastFeedback = signal<string | null>(null);

  readonly isAdvanceLeave = computed(() => {
    return this.hoursUntilClass() >= 24;
  });

  // 計算票卡剩餘百分比
  readonly progressPercent = computed(() => {
    const p = this.pack();
    if (!p || p.totalCount <= 0) return 0;
    return Math.round((p.remainingCount / p.totalCount) * 100);
  });

  switchStudent(id: string): void {
    this.state.setSelectedStudent(id);
  }

  openLeaveModal(): void {
    this.showLeaveConfirmModal.set(true);
  }

  closeLeaveModal(): void {
    this.showLeaveConfirmModal.set(false);
  }

  confirmLeave(): void {
    const stu = this.student();
    if (!stu) return;

    const res = this.state.requestLeave(stu.id, this.leaveReasonInput());
    this.closeLeaveModal();
    this.showToast(res.message);
  }

  cancelMyLeave(): void {
    const stu = this.student();
    if (!stu) return;
    if (confirm('確定要取消請假，恢復本週出席嗎？')) {
      this.state.cancelLeave(stu.id);
      this.showToast('✅ 已為您取消請假，期待週六在教室見到您！');
    }
  }

  private showToast(msg: string): void {
    this.toastFeedback.set(msg);
    setTimeout(() => {
      this.toastFeedback.set(null);
    }, 4500);
  }
}
