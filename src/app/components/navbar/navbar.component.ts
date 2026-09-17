import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { BalletStateService } from '../../services/ballet-state.service';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.scss']
})
export class NavbarComponent {
  readonly state = inject(BalletStateService);

  readonly hours = this.state.simulationHoursUntilClass;

  setHours(h: number): void {
    this.state.setSimulationHours(h);
  }

  resetData(): void {
    if (confirm('確定要將示範資料重置回初始狀態嗎？')) {
      this.state.resetMockData();
    }
  }
}
