export type TicketPackType = '5_class' | '10_class' | 'single' | 'trial';

export interface TicketPack {
  id: string;
  studentId: string;
  type: TicketPackType;
  totalCount: number;
  remainingCount: number;
  purchaseDate: string; // YYYY-MM-DD
  expiryDate: string; // YYYY-MM-DD
  status: 'active' | 'expired' | 'depleted';
  pricePaid?: number;
}

export interface Student {
  id: string;
  name: string;
  phone: string;
  lineUserId?: string;
  avatarUrl?: string;
  notes?: string;
  registeredAt: string;
}

export interface StudentWithActivePack extends Student {
  activePack?: TicketPack;
  daysUntilExpiry?: number;
  isNearExpiry?: boolean; // <= 14 days
}

export interface CreateStudentParams {
  name: string;
  phone: string;
  notes?: string;
  initialPackType?: 'none' | '5_class' | '10_class' | 'trial';
}

export interface UpdateStudentParams {
  name: string;
  phone: string;
  notes?: string;
}
