import {
  Component,
  ChangeDetectionStrategy,
  input,
  output,
  viewChild,
  effect
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCalendar, MatCalendarCellCssClasses, MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';

@Component({
  selector: 'lib-multi-date-calendar, app-multi-date-calendar',
  standalone: true,
  imports: [CommonModule, MatDatepickerModule, MatNativeDateModule],
  templateUrl: './multi-date-calendar.component.html',
  styleUrls: ['./multi-date-calendar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class MultiDateCalendarComponent {
  /** 已選取之開課日期陣列 (格式：'YYYY-MM-DD') */
  readonly selectedDates = input<string[]>([]);

  /** 限制不可選擇的最早日期 (預設 null) */
  readonly minDate = input<Date | null>(null);

  /** 選取日期異動事件，輸出年代升冪排序後之日期字串陣列 */
  readonly selectedDatesChange = output<string[]>();

  /** 取得 MatCalendar 實例訊號 */
  readonly calendar = viewChild<MatCalendar<Date>>(MatCalendar);

  constructor() {
    effect(() => {
      // 當外部傳入之 selectedDates 變動時，觸發 MatCalendar 更新視圖以重新著色
      this.selectedDates();
      this.refreshCalendar();
    });
  }

  private refreshCalendar(): void {
    const cal = this.calendar();
    if (!cal) return;
    try {
      const view = (cal as any)._getCurrentViewComponent?.();
      if (view && typeof view._init === 'function') {
        cal.updateTodaysDate();
      }
    } catch {
      // Safely ignore if internal calendar view is not yet ready
    }
  }

  /**
   * 供 MatCalendar dateClass 使用之樣式回呼
   * 若日期落於已選取清單中，回傳 'tdb-selected-date'
   */
  readonly dateClass = (date: Date): MatCalendarCellCssClasses => {
    const dateStr = this.formatDate(date);
    return this.selectedDates().includes(dateStr) ? 'tdb-selected-date' : '';
  };

  /**
   * 點選日曆日期格時觸發切換 (Toggle)
   */
  onDateSelected(date: Date | null): void {
    if (!date) return;

    const dateStr = this.formatDate(date);
    const current = this.selectedDates();
    let updated: string[];

    if (current.includes(dateStr)) {
      updated = current.filter(d => d !== dateStr);
    } else {
      updated = [...current, dateStr];
    }

    // 依據時間先後升冪排序 (YYYY-MM-DD 自然排序)
    updated.sort((a, b) => a.localeCompare(b));

    this.selectedDatesChange.emit(updated);
    this.refreshCalendar();
  }

  /**
   * 將 Date 物件轉為標準 YYYY-MM-DD 字串
   */
  private formatDate(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }
}
