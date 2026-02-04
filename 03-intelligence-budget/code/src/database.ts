/**
 * Mock database for expense examples
 * In a real system, this would be a proper database connection
 */

export interface Expense {
  id: string;
  number: string;
  amount: number;
  category: string;
  description: string;
  date?: string;
  receipt_url?: string;
  approval_id?: string;
  status: string;
  created_at: Date;
  metadata?: Record<string, unknown>;
}

export interface CategoryRules {
  max_amount: number;
  receipt_required_over: number;
  approval_required_over: number;
}

export interface Approval {
  id: string;
  amount: number;
  category: string;
  description: string;
  status: "pending" | "approved" | "denied";
  approver_id: string;
  approver_name: string;
  created_at: Date;
}

class MockDatabase {
  private expenses: Map<string, Expense> = new Map();
  private approvals: Map<string, Approval> = new Map();
  private expenseCounter = 1;
  private approvalCounter = 1;

  private categoryRules: Record<string, CategoryRules> = {
    meals: {
      max_amount: 150,
      receipt_required_over: 25,
      approval_required_over: 100,
    },
    client_entertainment: {
      max_amount: 500,
      receipt_required_over: 25,
      approval_required_over: 150,
    },
    team_meals: {
      max_amount: 300,
      receipt_required_over: 50,
      approval_required_over: 200,
    },
    travel: {
      max_amount: 5000,
      receipt_required_over: 50,
      approval_required_over: 500,
    },
    supplies: {
      max_amount: 1000,
      receipt_required_over: 100,
      approval_required_over: 500,
    },
    software: {
      max_amount: 2000,
      receipt_required_over: 0,
      approval_required_over: 500,
    },
  };

  async createExpense(data: Omit<Expense, "id" | "number" | "created_at">): Promise<Expense> {
    const id = `exp_${this.expenseCounter++}`;
    const number = `EXP-${String(this.expenseCounter).padStart(6, "0")}`;

    const expense: Expense = {
      ...data,
      id,
      number,
      created_at: new Date(),
    };

    this.expenses.set(id, expense);
    return expense;
  }

  async getExpense(id: string): Promise<Expense | undefined> {
    return this.expenses.get(id);
  }

  getExpenses(): Expense[] {
    return Array.from(this.expenses.values());
  }

  getCategoryRules(category: string): CategoryRules {
    return (
      this.categoryRules[category] || {
        max_amount: 1000,
        receipt_required_over: 100,
        approval_required_over: 500,
      }
    );
  }

  getAllCategoryRules(): Record<string, CategoryRules> {
    return { ...this.categoryRules };
  }

  async createApproval(data: {
    amount: number;
    category: string;
    description: string;
    approver_name?: string;
  }): Promise<Approval> {
    const id = `apr_${this.approvalCounter++}`;

    const approval: Approval = {
      id,
      amount: data.amount,
      category: data.category,
      description: data.description,
      status: "pending",
      approver_id: "mgr_001",
      approver_name: data.approver_name || "Jane Smith",
      created_at: new Date(),
    };

    this.approvals.set(id, approval);
    return approval;
  }

  async getApproval(id: string): Promise<Approval | undefined> {
    return this.approvals.get(id);
  }

  async approveApproval(id: string): Promise<Approval | undefined> {
    const approval = this.approvals.get(id);
    if (approval) {
      approval.status = "approved";
    }
    return approval;
  }
}

// Singleton instance
export const database = new MockDatabase();

// Mock receipt storage
export const storage = {
  async uploadReceipt(fileData: string, fileType: string): Promise<{ url: string; id: string }> {
    const id = `rcpt_${Date.now()}`;
    const url = `https://storage.example.com/receipts/${id}`;
    return { url, id };
  },
};
