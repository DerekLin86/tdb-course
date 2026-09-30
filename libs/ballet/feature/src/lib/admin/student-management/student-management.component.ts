import { Component, ChangeDetectionStrategy, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  BalletStateService,
  StudentWithActivePack,
  TicketPack,
  StudentAttendanceHistoryItem
} from '@libs/ballet/data-access';

@Component({
  selector: 'app-student-management',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './student-management.component.html',
  styleUrls: ['./student-management.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StudentManagementComponent {
  readonly state = inject(BalletStateService);

  readonly studentsWithPacks = this.state.studentsWithPacks;

  // 標籤頁切換
  readonly activeTab = signal<'tickets' | 'students'>('tickets');

  // 簽名放大查看彈窗
  readonly viewingSignature = signal<{
    name: string;
    time: string;
    imgUrl: string;
  } | null>(null);

  // 學員檔案與歷程 Signals
  readonly selectedStudentIdForHistory = signal<string>('');
  readonly studentSearchKeyword = signal<string>('');
  readonly editingDetailNotes = signal<string>('');
  readonly notesSaveMessage = signal<string | null>(null);

  // 模糊過濾學員清單
  readonly filteredStudentsForHistory = computed(() => {
    const list = this.studentsWithPacks();
    const kw = this.studentSearchKeyword().trim().toLowerCase();
    if (!kw) return list;
    return list.filter(s =>
      s.name.toLowerCase().includes(kw) ||
      s.phone.includes(kw) ||
      (s.notes && s.notes.toLowerCase().includes(kw))
    );
  });

  // 當前選取查看的學員檔案（若未手動選取則預設選取過濾清單或全體學員的第一位）
  readonly selectedStudentForHistory = computed<StudentWithActivePack | null>(() => {
    const id = this.selectedStudentIdForHistory();
    const filtered = this.filteredStudentsForHistory();
    const all = this.studentsWithPacks();

    if (id) {
      const found = all.find(s => s.id === id);
      if (found) return found;
    }

    if (filtered.length > 0) return filtered[0];
    if (all.length > 0) return all[0];
    return null;
  });

  // 當前選取學員的完整上課歷程（依時間降冪）
  readonly selectedStudentAttendanceHistory = computed<StudentAttendanceHistoryItem[]>(() => {
    const stu = this.selectedStudentForHistory();
    if (!stu) return [];
    return this.state.getStudentAttendanceHistory(stu.id);
  });

  // 當前選取學員的所有票卡歷史（依購買日期降冪）
  readonly selectedStudentPacksHistory = computed<TicketPack[]>(() => {
    const stu = this.selectedStudentForHistory();
    if (!stu) return [];
    return this.state.getStudentTicketPacks(stu.id);
  });

  // 當前選取學員的出席與票卡統計
  readonly selectedStudentStats = computed(() => {
    const history = this.selectedStudentAttendanceHistory();
    const stu = this.selectedStudentForHistory();
    let attended = 0;
    let advanceLeave = 0;
    let lateLeave = 0;
    let absent = 0;

    for (const item of history) {
      switch (item.record.status) {
        case 'attended':
          attended++;
          break;
        case 'leave_advance':
          advanceLeave++;
          break;
        case 'leave_late':
          lateLeave++;
          break;
        case 'absent':
          absent++;
          break;
      }
    }

    return {
      totalAttended: attended,
      totalAdvanceLeave: advanceLeave,
      totalLateLeave: lateLeave,
      totalAbsent: absent,
      totalSessionsEnrolled: history.length,
      remainingCount: stu?.activePack?.remainingCount ?? 0,
      activePackType: stu?.activePack?.type,
      activePackExpiry: stu?.activePack?.expiryDate
    };
  });

  constructor() {
    // 監聽選取學員變動，同步載入該學員最新備註
    effect(() => {
      const stu = this.selectedStudentForHistory();
      this.editingDetailNotes.set(stu?.notes || '');
      this.notesSaveMessage.set(null);
    }, { allowSignalWrites: true });
  }

  // 新增學員彈窗 Signals
  readonly showAddStudentModal = signal<boolean>(false);
  readonly newStudentName = signal<string>('');
  readonly newStudentPhone = signal<string>('');
  readonly newStudentNotes = signal<string>('');
  readonly newStudentPackType = signal<'none' | '5_class' | '10_class' | 'trial'>('10_class');
  readonly addStudentError = signal<string | null>(null);

  // 編輯學員彈窗 Signals
  readonly showEditStudentModal = signal<boolean>(false);
  readonly editingStudentId = signal<string | null>(null);
  readonly editStudentName = signal<string>('');
  readonly editStudentPhone = signal<string>('');
  readonly editStudentNotes = signal<string>('');
  readonly editStudentError = signal<string | null>(null);

  // 開啟新增學員彈窗
  openAddStudentModal(): void {
    this.addStudentError.set(null);
    this.newStudentName.set('');
    this.newStudentPhone.set('');
    this.newStudentNotes.set('');
    this.newStudentPackType.set('10_class');
    this.showAddStudentModal.set(true);
  }

  closeAddStudentModal(): void {
    this.showAddStudentModal.set(false);
    this.addStudentError.set(null);
  }

  submitAddStudent(): void {
    const name = this.newStudentName().trim();
    const phone = this.newStudentPhone().trim();
    const notes = this.newStudentNotes().trim();
    const packType = this.newStudentPackType();

    if (!name) {
      this.addStudentError.set('請輸入學員姓名');
      return;
    }
    if (!phone) {
      this.addStudentError.set('請輸入聯絡電話');
      return;
    }

    // 檢查電話是否已被註冊
    const existing = this.state.students().find(s => s.phone === phone);
    if (existing) {
      this.addStudentError.set(`此電話已被學員【${existing.name}】使用`);
      return;
    }

    const created = this.state.addStudent({
      name,
      phone,
      notes: notes || undefined,
      initialPackType: packType
    });

    this.closeAddStudentModal();
    alert(`✅ 已成功新增學員【${created.name}】！`);
  }

  // 開啟編輯學員彈窗
  openEditStudentModal(student: StudentWithActivePack): void {
    this.editStudentError.set(null);
    this.editingStudentId.set(student.id);
    this.editStudentName.set(student.name);
    this.editStudentPhone.set(student.phone);
    this.editStudentNotes.set(student.notes || '');
    this.showEditStudentModal.set(true);
  }

  closeEditStudentModal(): void {
    this.showEditStudentModal.set(false);
    this.editingStudentId.set(null);
    this.editStudentError.set(null);
  }

  submitEditStudent(): void {
    const studentId = this.editingStudentId();
    if (!studentId) return;

    const name = this.editStudentName().trim();
    const phone = this.editStudentPhone().trim();
    const notes = this.editStudentNotes().trim();

    if (!name) {
      this.editStudentError.set('學員姓名不能為空');
      return;
    }
    if (!phone) {
      this.editStudentError.set('聯絡電話不能為空');
      return;
    }

    // 檢查電話是否與其他學員衝突
    const conflict = this.state.students().find(s => s.phone === phone && s.id !== studentId);
    if (conflict) {
      this.editStudentError.set(`電話號碼已被其他學員【${conflict.name}】使用`);
      return;
    }

    this.state.updateStudent(studentId, {
      name,
      phone,
      notes: notes || undefined
    });

    this.closeEditStudentModal();
    alert(`✅ 已更新學員【${name}】的資料！`);
  }

  // 刪除 / 減少學員
  handleDeleteStudent(student: StudentWithActivePack): void {
    if (
      confirm(
        `⚠️ 確定要從班級名單中移除【${student.name}】嗎？\n\n該學員的所有票卡與出勤預約記錄亦將同步清除。`
      )
    ) {
      this.state.deleteStudent(student.id);
      alert(`已成功將【${student.name}】自班級名單中移除。`);
    }
  }

  // 儲值票卡
  handleAddPack(student: StudentWithActivePack, type: '5_class' | '10_class' | 'trial'): void {
    if (type === 'trial') {
      if (this.state.hasPurchasedTrial(student.id)) {
        alert(`【${student.name}】已曾購買過體驗課，每位學員終身限購 1 次！請選購 5 堂或 10 堂常規方案。`);
        return;
      }
      if (confirm(`確定為【${student.name}】儲值 1 堂體驗課（優惠價 NT$ 400，效期 14 天）嗎？每位學員終身限購 1 次。`)) {
        const res = this.state.addTicketPack(student.id, 'trial', 1, 14, 400);
        alert(res.message);
      }
      return;
    }

    const count = type === '5_class' ? 5 : 10;
    const days = type === '5_class' ? 60 : 100;
    if (confirm(`確定為【${student.name}】儲值 ${count} 堂課票卡（效期 ${days} 天）嗎？`)) {
      const res = this.state.addTicketPack(student.id, type, count, days);
      alert(res.message);
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

  // 切換選取的學員檢視
  selectStudentForHistory(studentId: string): void {
    this.selectedStudentIdForHistory.set(studentId);
    const stu = this.studentsWithPacks().find(s => s.id === studentId);
    this.editingDetailNotes.set(stu?.notes || '');
    this.notesSaveMessage.set(null);
  }

  // 儲存學員備註
  saveStudentNotes(): void {
    const stu = this.selectedStudentForHistory();
    if (!stu) return;

    this.state.updateStudentNotes(stu.id, this.editingDetailNotes());
    this.notesSaveMessage.set('✅ 備註已成功儲存！');
    setTimeout(() => {
      this.notesSaveMessage.set(null);
    }, 2500);
  }

  // 檢視放大簽名
  openSignatureModal(name: string, time: string, imgUrl?: string): void {
    if (!imgUrl) return;
    this.viewingSignature.set({ name, time, imgUrl });
  }

  closeSignatureModal(): void {
    this.viewingSignature.set(null);
  }
}
