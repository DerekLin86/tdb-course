import {
  Component,
  ElementRef,
  viewChild,
  input,
  output,
  signal,
  AfterViewInit,
  OnDestroy,
  HostListener
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { SignaturePadConfig } from '@libs/ballet/data-access';

interface Point {
  x: number;
  y: number;
}

@Component({
  selector: 'app-signature-pad',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './signature-pad.component.html',
  styleUrls: ['./signature-pad.component.scss']
})
export class SignaturePadComponent implements AfterViewInit, OnDestroy {
  // Signal Inputs
  readonly studentName = input.required<string>();
  readonly remainingCount = input<number>(0);
  readonly config = input<SignaturePadConfig>({});

  // Signal Outputs
  readonly signed = output<string>(); // emits Base64 PNG
  readonly cancelled = output<void>();

  // Canvas ViewChild Signal
  readonly canvasRef = viewChild<ElementRef<HTMLCanvasElement>>('signatureCanvas');

  // Internal Signals
  readonly isDrawing = signal<boolean>(false);
  readonly hasSignature = signal<boolean>(false);
  readonly strokeCount = signal<number>(0);
  readonly errorMessage = signal<string>('');

  private ctx: CanvasRenderingContext2D | null = null;
  private points: Point[] = [];
  private dpr = 1;

  ngAfterViewInit(): void {
    this.initCanvas();
  }

  ngOnDestroy(): void {
    this.points = [];
  }

  @HostListener('window:resize')
  onResize(): void {
    // 當視窗縮放時保留現有簽名或重新適應
    this.resizeCanvas();
  }

  private initCanvas(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;

    this.ctx = canvas.getContext('2d');
    this.resizeCanvas();
  }

  private resizeCanvas(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas || !this.ctx) return;

    const rect = canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;

    // 備份現有影像以防重繪消失
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');
    if (tempCtx) {
      tempCtx.drawImage(canvas, 0, 0);
    }

    canvas.width = rect.width * this.dpr;
    canvas.height = rect.height * this.dpr;

    this.ctx.scale(this.dpr, this.dpr);
    this.setupContextStyle();

    // 還原影像
    if (tempCanvas.width > 0 && tempCanvas.height > 0) {
      this.ctx.drawImage(tempCanvas, 0, 0, rect.width, rect.height);
    }
  }

  private setupContextStyle(): void {
    if (!this.ctx) return;
    const cfg = this.config();
    this.ctx.strokeStyle = cfg?.strokeColor || '#1e293b';
    this.ctx.lineWidth = cfg?.strokeWidth || 3.5;
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
  }

  // Pointer / Touch Handlers
  onPointerDown(event: PointerEvent): void {
    event.preventDefault();
    this.errorMessage.set('');
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas || !this.ctx) return;

    canvas.setPointerCapture(event.pointerId);
    this.isDrawing.set(true);

    const pos = this.getPointerPos(event);
    this.points = [pos];

    this.ctx.beginPath();
    this.ctx.moveTo(pos.x, pos.y);
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.isDrawing() || !this.ctx) return;
    event.preventDefault();

    const pos = this.getPointerPos(event);
    this.points.push(pos);

    if (this.points.length >= 3) {
      // 貝茲曲線平滑處理
      const xc = (this.points[this.points.length - 2].x + this.points[this.points.length - 1].x) / 2;
      const yc = (this.points[this.points.length - 2].y + this.points[this.points.length - 1].y) / 2;
      this.ctx.quadraticCurveTo(
        this.points[this.points.length - 2].x,
        this.points[this.points.length - 2].y,
        xc,
        yc
      );
      this.ctx.stroke();
    } else {
      this.ctx.lineTo(pos.x, pos.y);
      this.ctx.stroke();
    }

    this.hasSignature.set(true);
    this.strokeCount.update(c => c + 1);
  }

  onPointerUp(event: PointerEvent): void {
    if (!this.isDrawing()) return;
    event.preventDefault();
    this.isDrawing.set(false);
    this.points = [];

    const canvas = this.canvasRef()?.nativeElement;
    if (canvas && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
  }

  private getPointerPos(event: PointerEvent): Point {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
  }

  clearSignature(): void {
    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas || !this.ctx) return;

    this.ctx.clearRect(0, 0, canvas.width / this.dpr, canvas.height / this.dpr);
    this.hasSignature.set(false);
    this.strokeCount.set(0);
    this.errorMessage.set('');
  }

  confirmSignature(): void {
    if (!this.hasSignature() || this.strokeCount() < 5) {
      this.errorMessage.set('請先在框內完成手寫簽名喔！');
      return;
    }

    const canvas = this.canvasRef()?.nativeElement;
    if (!canvas) return;

    const dataUrl = canvas.toDataURL('image/png');
    this.signed.emit(dataUrl);
  }

  onCancel(): void {
    this.cancelled.emit();
  }
}
