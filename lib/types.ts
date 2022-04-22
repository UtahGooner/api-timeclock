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
    week2StartDate:string,
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
export interface BaseEntryAction {
    id?: number,
    idEntry: number,
    actionType: number,
    time: string|Date,
    ip: string,
    notes: object|string,
}
export interface EntryAction extends BaseEntryAction {
    id: number,
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

export interface BaseEntry {
    id?: number,
    idEmployee: number,
    idEntryType: number,
    idUser: number,
    EntryDate: string|Date,
    Duration: number,
    idPayPeriod?: number,
    Note?: string,
}
export interface Entry extends BaseEntry {
    id: number,
    EmployeeApproved: boolean|1|0,
    EmployeeApprovalTime: string|null,
    Approved: boolean|1|0,
    ApprovedBy: number,
    ApprovalTime: string|null,
    deleted: boolean|1|0,
    deletedBy: number,
    idPayPeriod: number,
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

export interface PRImportLine {
    EmployeeKey: string,
    WeeksWorked: number,
    DaysWorked: number,
    EarningsCode: string,
    EarningsType: string,
    hours: number,
}

export interface PRImportData {
    EmployeeKey: string,
    Department: string,
    EmployeeNumber: string,
    PayMethod: string,
    DayWorked: string,
    WeekWorked: number,
    EarningsCode: string,
    EarningsType: string,
    seconds: number,
}

export interface ClockActionOptions {
    ip: string,
    userId: number,
    idEntry?: number|string,
    override?: boolean,
    entryDate?: string|Date,
    notes?: string,
}

export interface ClockActionBody {
    loginCode: string,
    override?: boolean,
    idEntry?: number,
    notes?: string,
    entryDate?: string,
}

export interface ClockActionResult {
    entry?: Entry|null,
    existing?: Entry|null,
    warning?: string,
}

export interface AdjustClockProps {
    idEmployee: number,
    idEntry: number|string,
    idUser: number,
    action: BaseEntryAction,
    comment?: string,
}

export interface EntryType {
    id: number,
    SageCode: string,
    ShortCode: string,
    Description: string,
    active: boolean|1|0,
}

export interface EntryTypeList {
    [key: number]: EntryType,
}
