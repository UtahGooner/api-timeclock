export interface BannerImage {
    id: number,
    filename?: string,
    overlay: string,
    active: boolean|1|0,
    timestamp?: string,
}

export interface PayPeriod {
    id: number,
    startDate: string,
    endDate: string,
    completed: boolean|1|0,
}

export interface Department {
    Department: string,
    Description: string,
    active: boolean|1|0,
}

export interface Supervisor {
    id: number,
    idUser: number,
    name: string,
}

export interface EmployeeBase {
    id: number,
    LoginCode: string,
    Department: string,
    EmployeeNumber: string,
    EmployeeStatus: 'A' | 'I' | 'T',
    LastName: string,
    FirstName: string,
    PayMethod: 'H' | 'S',
}

export interface EmployeeDates {
    HireDate: string | null,
    TerminationDate: string | null,
}

export interface EmployeePersonalLeave {
    HoursAccrued: number,
    HoursUsed: number,
    AnnualHourLimit: number,
    CarryOverHours: number,
    HoursAvailable: number,
}

export interface Employee extends EmployeeBase, EmployeeDates, EmployeePersonalLeave {}

export interface EmployeePayPeriodTotal extends EmployeeBase, EmployeePersonalLeave {
    idPayPeriod: number,
    entries?: Entry[],
    weeks: [EntryWeek, EntryWeek],
}

export interface EntryAction {
    id: number,
    idEntry: number,
    actionType: number,
    time: string,
    ip: string,
    notes: object|string,
    timestamp: string,
}

export interface EntryWeek {
    ApprovedBy?: number|null,
    ApprovalTime?: string|null,
    Approved: boolean,
    Duration: number,
    EmployeeApprovalTime?: string|null,
    EmployeeApproved: boolean,
    Overtime: number,
    PersonalLeaveDuration: number,
    hasErrors: boolean,
    isClockedIn: boolean,
}

export interface Entry {
    id: number,
    idEmployee: number,
    idEntryType: number,
    idUser: number,
    EntryDate: string|Date,
    Duration: number,
    Note?: string,
    EmployeeApproved: boolean|1|0,
    EmployeeApprovalTime?: string,
    Approved: boolean|1|0,
    ApprovedBy: number,
    ApprovalTime?: string,
    deleted: boolean|1|0,
    deletedBy: number,
    timestamp: string,
    actions: EntryAction[],
    isClockedIn: boolean|1|0,
    Week: 0|1,
    errors: string[],
}

export interface BaseSalary {
    value?: number,
    minValue?: number,
    maxValue?: number,
    unitText?: string,
}
export interface JobPosting {
    id: number,
    title:string,
    enabled: boolean|1|0,
    description: string,
    datePosted: Date|string|null,
    jobLocation: string,
    validThrough: Date|string|null,
    baseSalary?: string|BaseSalary|null,
    employmentType: string,
    educationalRequirements: string,
    experienceRequirements: number
    experienceInPlaceOfEducation: boolean|1|0,
    filename: string,
    emailRecipient?: string,
    applicationInstructions?:string,
    timestamp: string,
}

export interface PayPeriodSSEmployee {
    EmployeeKey: string,
    EmployeeName: string,
    Department: string,
    EmployeeNumber: string,
    PayMethod: string,
}
export interface PayPeriodSSEarnings {
    Hours_000001: number|string,
    Hours_000002: number|string,
    Hours_000003: number|string,
    Hours_000004: number|string,
    Hours_000011: number|string,
    Hours_ASSIST: number|string,
    Hours_FMLA67: number|string,
    Hours_FMLA10: number|string,
}
export interface PayPeriodSSRecord extends PayPeriodSSEmployee, PayPeriodSSEarnings {
    EmployeeApprovalTime: number|string|Date,
    SupervisorApprovalTime: number|string|Date,
    SupervisorName: string,
    WeekNumber?: string|number,
    seconds?: number,
}
