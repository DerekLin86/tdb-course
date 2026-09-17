import { ComponentFixture, TestBed } from '@angular/core/testing';
import { SignaturePadComponent } from './signature-pad.component';

describe('SignaturePadComponent', () => {
  let component: SignaturePadComponent;
  let fixture: ComponentFixture<SignaturePadComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SignaturePadComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(SignaturePadComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('studentName', '陳秀琴');
    fixture.componentRef.setInput('remainingCount', 7);
    fixture.detectChanges();
  });

  it('應正確建立元件並顯示學員大名', () => {
    expect(component).toBeTruthy();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('.highlight-name')?.textContent).toContain('陳秀琴');
  });

  it('未在畫布簽名時點擊完成簽到，應提示錯誤訊息', () => {
    component.confirmSignature();
    fixture.detectChanges();

    expect(component.hasSignature()).toBeFalse();
    expect(component.errorMessage()).toContain('請先在框內完成手寫簽名');
  });

  it('清除簽名應重設狀態與清除錯誤訊息', () => {
    component.errorMessage.set('錯誤測試');
    component.hasSignature.set(true);

    component.clearSignature();

    expect(component.hasSignature()).toBeFalse();
    expect(component.errorMessage()).toBe('');
  });
});
