import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SessionManagementComponent } from './session-management.component';
import { BalletStateService } from '@libs/ballet/data-access';

describe('SessionManagementComponent (期班課堂管理與學員名冊加入單元測試)', () => {
  let component: SessionManagementComponent;
  let fixture: ComponentFixture<SessionManagementComponent>;
  let stateService: BalletStateService;

  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({
      imports: [SessionManagementComponent],
      providers: [BalletStateService]
    }).compileComponents();

    stateService = TestBed.inject(BalletStateService);
    stateService.resetMockData();

    fixture = TestBed.createComponent(SessionManagementComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('1. 元件初始化與預設值 (Component Initialization & Defaults)', () => {
    it('應成功建立元件實例', () => {
      expect(component).toBeTruthy();
    });

    it('初始加入學員模式 enrollMode 應為 "existing"', () => {
      expect(component.enrollMode()).toBe('existing');
    });

    it('初始已選取的學員清單 selectedStudentIdsToEnroll 應為空陣列', () => {
      expect(component.selectedStudentIdsToEnroll()).toEqual([]);
    });
  });

  describe('2. 既有學員多選核取清單操作 (Multi-select Checklist Operations)', () => {
    it('toggleStudentSelection 應在學員未選取時加入清單，已選取時自清單移除', () => {
      expect(component.selectedStudentIdsToEnroll()).toEqual([]);

      component.toggleStudentSelection('stu-10');
      expect(component.selectedStudentIdsToEnroll()).toEqual(['stu-10']);

      component.toggleStudentSelection('stu-9');
      expect(component.selectedStudentIdsToEnroll()).toEqual(['stu-10', 'stu-9']);

      component.toggleStudentSelection('stu-10');
      expect(component.selectedStudentIdsToEnroll()).toEqual(['stu-9']);

      component.toggleStudentSelection('stu-9');
      expect(component.selectedStudentIdsToEnroll()).toEqual([]);
    });

    it('selectAllAvailableStudents 應將目前 filteredAvailableStudents 的所有學員 ID 全部加入', () => {
      stateService.setSelectedCourse('course-2');
      fixture.detectChanges();

      const available = component.filteredAvailableStudents();
      expect(available.length).toBeGreaterThan(0);

      component.selectAllAvailableStudents();
      const selected = component.selectedStudentIdsToEnroll();

      expect(selected.length).toBe(available.length);
      available.forEach(student => {
        expect(selected).toContain(student.id);
      });
    });

    it('clearSelectedStudents 應清空所有已選取的學員 ID', () => {
      component.toggleStudentSelection('stu-1');
      component.toggleStudentSelection('stu-2');
      expect(component.selectedStudentIdsToEnroll().length).toBe(2);

      component.clearSelectedStudents();
      expect(component.selectedStudentIdsToEnroll()).toEqual([]);
    });
  });

  describe('3. 既有學員搜尋與過濾 (Existing Students Search Filtering)', () => {
    beforeEach(() => {
      stateService.setSelectedCourse('course-2');
      fixture.detectChanges();
    });

    it('filteredAvailableStudents 應正確依學員姓名進行不分大小寫過濾', () => {
      component.existingSearchQuery.set('陳秀琴');
      const filteredByName = component.filteredAvailableStudents();
      expect(filteredByName.length).toBe(1);
      expect(filteredByName[0].name).toBe('陳秀琴');

      component.existingSearchQuery.set('non-existent-student-name');
      expect(component.filteredAvailableStudents().length).toBe(0);
    });

    it('filteredAvailableStudents 應正確依電話號碼純數字進行模糊過濾', () => {
      component.existingSearchQuery.set('0912');
      const filteredByPhone = component.filteredAvailableStudents();
      expect(filteredByPhone.length).toBeGreaterThanOrEqual(1);
      expect(filteredByPhone.some(s => s.phone.includes('0912'))).toBeTrue();
    });

    it('當 existingSearchQuery 為空時應回傳全部可選取的學員', () => {
      component.existingSearchQuery.set('');
      const allAvailable = component.availableStudentsToEnroll();
      expect(component.filteredAvailableStudents().length).toBe(allAvailable.length);
    });
  });

  describe('4. 既有學員批次加入名冊提交 (Batch Enroll Existing Students Submission)', () => {
    it('若未選取任何學員，submitBatchEnrollStudents 應設定 enrollError 且不呼叫服務', () => {
      const enrollSpy = spyOn(stateService, 'enrollStudentsBatchInCourse');
      component.selectedStudentIdsToEnroll.set([]);

      component.submitBatchEnrollStudents();

      expect(component.enrollError()).toBe('請至少選取一位學員');
      expect(enrollSpy).not.toHaveBeenCalled();
    });

    it('若無當前期班課程與課堂，submitBatchEnrollStudents 應提示未指定期班課程', () => {
      stateService.courses.set([]);
      stateService.sessions.set([]);
      fixture.detectChanges();

      component.selectedStudentIdsToEnroll.set(['stu-1']);
      component.submitBatchEnrollStudents();

      expect(component.enrollError()).toBe('未指定期班課程');
    });

    it('選取有效學員時，應呼叫 state.enrollStudentsBatchInCourse 並關閉彈窗', () => {
      const enrollSpy = spyOn(stateService, 'enrollStudentsBatchInCourse').and.callThrough();
      component.openEnrollModal();
      component.selectedStudentIdsToEnroll.set(['stu-10']);

      component.submitBatchEnrollStudents();

      expect(enrollSpy).toHaveBeenCalledWith('course-1', ['stu-10']);
      expect(component.showEnrollModal()).toBeFalse();
    });
  });

  describe('5. 建立單筆新學員並加入名冊 (Quick Create & Enroll Submission)', () => {
    it('姓名為空時，submitQuickCreateAndEnroll 應設定 enrollError 且不呼叫 addStudent', () => {
      const addSpy = spyOn(stateService, 'addStudent');
      component.openEnrollModal();
      component.newQuickStudentName.set('');
      component.newQuickStudentPhone.set('0988111222');

      component.submitQuickCreateAndEnroll();

      expect(component.enrollError()).toBe('請輸入學員姓名');
      expect(addSpy).not.toHaveBeenCalled();
    });

    it('電話為空時，submitQuickCreateAndEnroll 應設定 enrollError 且不呼叫 addStudent', () => {
      const addSpy = spyOn(stateService, 'addStudent');
      component.openEnrollModal();
      component.newQuickStudentName.set('新同學');
      component.newQuickStudentPhone.set('');

      component.submitQuickCreateAndEnroll();

      expect(component.enrollError()).toBe('請輸入聯絡電話');
      expect(addSpy).not.toHaveBeenCalled();
    });

    it('電話已被既有學員使用時，應設定 enrollError 提示重複且不呼叫 addStudent', () => {
      const addSpy = spyOn(stateService, 'addStudent');
      component.openEnrollModal();
      component.newQuickStudentName.set('重名同學');
      component.newQuickStudentPhone.set('0912345678');

      component.submitQuickCreateAndEnroll();

      expect(component.enrollError()).toContain('已被學員【陳秀琴】使用');
      expect(addSpy).not.toHaveBeenCalled();
    });

    it('資料有效時，應呼叫 state.addStudent 與 state.enrollStudentInCourse 並關閉彈窗', () => {
      const addSpy = spyOn(stateService, 'addStudent').and.callThrough();
      const enrollCourseSpy = spyOn(stateService, 'enrollStudentInCourse').and.callThrough();

      component.openEnrollModal();
      component.newQuickStudentName.set('芭蕾新手');
      component.newQuickStudentPhone.set('0999888777');
      component.newQuickStudentNotes.set('腳踝曾扭傷');
      component.newQuickStudentPackType.set('trial');

      component.submitQuickCreateAndEnroll();

      expect(addSpy).toHaveBeenCalledWith({
        name: '芭蕾新手',
        phone: '0999888777',
        notes: '腳踝曾扭傷',
        initialPackType: 'trial'
      });
      const createdStudent = stateService.students().find(s => s.phone === '0999888777');
      expect(createdStudent).toBeTruthy();
      expect(enrollCourseSpy).toHaveBeenCalledWith('course-1', createdStudent!.id);
      expect(component.showEnrollModal()).toBeFalse();
    });
  });

  describe('6. 彈窗重設行為 (Modal Reset Behavior)', () => {
    it('openEnrollModal 應重設選取清單、搜尋字串與錯誤訊息，並開啟彈窗', () => {
      component.selectedStudentIdsToEnroll.set(['stu-1', 'stu-2']);
      component.existingSearchQuery.set('關鍵字');
      component.enrollError.set('舊錯誤');

      component.openEnrollModal();

      expect(component.showEnrollModal()).toBeTrue();
      expect(component.selectedStudentIdsToEnroll()).toEqual([]);
      expect(component.existingSearchQuery()).toBe('');
      expect(component.enrollError()).toBeNull();
    });

    it('closeEnrollModal 應關閉彈窗並清空暫存選取狀態與錯誤', () => {
      component.openEnrollModal();
      component.selectedStudentIdsToEnroll.set(['stu-1']);
      component.existingSearchQuery.set('搜尋');
      component.enrollError.set('錯誤');

      component.closeEnrollModal();

      expect(component.showEnrollModal()).toBeFalse();
      expect(component.selectedStudentIdsToEnroll()).toEqual([]);
      expect(component.existingSearchQuery()).toBe('');
      expect(component.enrollError()).toBeNull();
    });

    it('openEnrollModal 當無期班亦無課堂時應跳出提示警告並不開啟彈窗', () => {
      stateService.courses.set([]);
      stateService.sessions.set([]);
      fixture.detectChanges();

      const alertSpy = spyOn(window, 'alert');
      component.openEnrollModal();

      expect(alertSpy).toHaveBeenCalledWith('請先選擇期班或排定課堂，再為名冊加入學員。');
      expect(component.showEnrollModal()).toBeFalse();
    });
  });

  describe('7. 刪除課堂彈窗與操作 (Delete Session Modal & Operations)', () => {
    it('openDeleteSessionModal() 未帶參數時，應預設將目前選定的 session 設為 sessionToDelete 並開啟彈窗', () => {
      const current = component.session();
      expect(current).toBeTruthy();

      component.openDeleteSessionModal();

      expect(component.showDeleteSessionModal()).toBeTrue();
      expect(component.sessionToDelete()).toEqual(current);
    });

    it('openDeleteSessionModal() 帶入指定 session 時，應將該 session 設為 sessionToDelete 並開啟彈窗', () => {
      const all = stateService.sessions();
      const specificSession = all[1];
      expect(specificSession).toBeTruthy();

      component.openDeleteSessionModal(specificSession);

      expect(component.showDeleteSessionModal()).toBeTrue();
      expect(component.sessionToDelete()).toEqual(specificSession);
    });

    it('openDeleteSessionModal() 當無任何課堂且未傳參數時，不應開啟彈窗', () => {
      stateService.sessions.set([]);
      fixture.detectChanges();

      component.openDeleteSessionModal();

      expect(component.showDeleteSessionModal()).toBeFalse();
      expect(component.sessionToDelete()).toBeNull();
    });

    it('closeDeleteSessionModal() 應關閉彈窗並將 sessionToDelete 清空為 null', () => {
      component.openDeleteSessionModal();
      expect(component.showDeleteSessionModal()).toBeTrue();
      expect(component.sessionToDelete()).toBeTruthy();

      component.closeDeleteSessionModal();

      expect(component.showDeleteSessionModal()).toBeFalse();
      expect(component.sessionToDelete()).toBeNull();
    });

    it('confirmDeleteSession() 應呼叫 state.deleteSession 刪除指定課堂並關閉彈窗', () => {
      const deleteSpy = spyOn(stateService, 'deleteSession').and.callThrough();
      const current = component.session();
      expect(current).toBeTruthy();

      component.openDeleteSessionModal();
      component.confirmDeleteSession();

      expect(deleteSpy).toHaveBeenCalledWith(current!.id);
      expect(component.showDeleteSessionModal()).toBeFalse();
      expect(component.sessionToDelete()).toBeNull();
    });

    it('confirmDeleteSession() 當無 target 課堂時應直接返回不進行任何操作', () => {
      const deleteSpy = spyOn(stateService, 'deleteSession').and.callThrough();
      stateService.sessions.set([]);
      fixture.detectChanges();

      component.confirmDeleteSession();

      expect(deleteSpy).not.toHaveBeenCalled();
      expect(component.showDeleteSessionModal()).toBeFalse();
    });
  });
});
