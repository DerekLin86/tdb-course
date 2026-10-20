import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNativeDateAdapter } from '@angular/material/core';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MultiDateCalendarComponent } from './multi-date-calendar.component';

describe('MultiDateCalendarComponent', () => {
  let component: MultiDateCalendarComponent;
  let fixture: ComponentFixture<MultiDateCalendarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MultiDateCalendarComponent],
      providers: [
        provideNativeDateAdapter(),
        provideAnimationsAsync()
      ]
    }).compileComponents();

    fixture = TestBed.createComponent(MultiDateCalendarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('應正確建立元件實例', () => {
    expect(component).toBeTruthy();
  });

  it('點擊未選取之日期應加入該日期並按時間升冪排序發出', () => {
    fixture.componentRef.setInput('selectedDates', ['2026-11-05']);
    fixture.detectChanges();

    const emittedSpy: string[][] = [];
    component.selectedDatesChange.subscribe((dates: string[]) => {
      emittedSpy.push(dates);
    });

    const dateToAdd = new Date(2026, 9, 20); // 2026-10-20
    component.onDateSelected(dateToAdd);

    expect(emittedSpy.length).toBe(1);
    expect(emittedSpy[0]).toEqual(['2026-10-20', '2026-11-05']);
  });

  it('點擊已選取之日期應自清單中移除該日期並發出', () => {
    fixture.componentRef.setInput('selectedDates', ['2026-10-20', '2026-11-05']);
    fixture.detectChanges();

    const emittedSpy: string[][] = [];
    component.selectedDatesChange.subscribe((dates: string[]) => {
      emittedSpy.push(dates);
    });

    const dateToRemove = new Date(2026, 9, 20); // 2026-10-20
    component.onDateSelected(dateToRemove);

    expect(emittedSpy.length).toBe(1);
    expect(emittedSpy[0]).toEqual(['2026-11-05']);
  });

  it('多個日期加入時應始終維持年代日期排序 (YYYY-MM-DD)', () => {
    fixture.componentRef.setInput('selectedDates', ['2026-12-01', '2026-10-15']);
    fixture.detectChanges();

    const emittedSpy: string[][] = [];
    component.selectedDatesChange.subscribe((dates: string[]) => {
      emittedSpy.push(dates);
    });

    const middleDate = new Date(2026, 10, 10); // 2026-11-10
    component.onDateSelected(middleDate);

    expect(emittedSpy[0]).toEqual(['2026-10-15', '2026-11-10', '2026-12-01']);
  });

  it('dateClass 應對已選取之日期回傳 tdb-selected-date，其餘回傳空字串', () => {
    fixture.componentRef.setInput('selectedDates', ['2026-10-25']);
    fixture.detectChanges();

    const selectedDate = new Date(2026, 9, 25);
    const unselectedDate = new Date(2026, 9, 26);

    expect(component.dateClass(selectedDate)).toBe('tdb-selected-date');
    expect(component.dateClass(unselectedDate)).toBe('');
  });

  it('傳入 null 日期至 onDateSelected 應忽略且不發出事件', () => {
    const emittedSpy: string[][] = [];
    component.selectedDatesChange.subscribe((dates: string[]) => {
      emittedSpy.push(dates);
    });

    component.onDateSelected(null);
    expect(emittedSpy.length).toBe(0);
  });
});
