import {BaseEntry, EntryTypeList, EntryWeek} from "../types";


export const ENTRY_TYPES = {
    TIMECLOCK: 1,
    MANUAL: 2,
    HOLIDAY: 3,
    PERSONAL_LEAVE: 4,
    BEREAV_JURY: 5,
    OVERTIME: 6,
    AUTOMATIC: 7,
    COMPANY_TIME: 8,
    SWAP_TIME: 9,
    MED_ASSIST: 10,
    FMLA_100: 11,
    FMLA_67: 12
}
export const ENTRY_TYPE_DESCRIPTIONS = {
    1: 'Timeclock',
    2: 'Manual Entry',
    3: 'Holiday',
    4: 'Personal Leave',
    5: 'Jury / Bereavement',
    6: 'Overtime',
    7: 'Auto Generated',
    8: 'Company Time',
    9: 'Swap Time',
};

export const CLOCK_ADJ_ACTION = 1;
export const CLOCK_IN_ACTION = 2;
export const CLOCK_OUT_ACTION = 4;
export const CLOCK_COMMENT_ACTION = 8;

export const MISSING_CLOCK_MAX_HOURS = 16;
export const STD_HOURS = 40 * 60 * 60;

export const DEFAULT_WEEK: EntryWeek = {
    Duration: 0,
    Overtime: 0,
    hasErrors: false,
    Approved: true,
    ApprovedBy: null,
    ApprovalTime: null,
    EmployeeApproved: true,
    EmployeeApprovalTime: null,
    PersonalLeaveDuration: 0,
    isClockedIn: false,
};

export const WARNING_CLOCKED_IN = 'Currently clocked in or missing previous clock out action';
export const WARNING_CLOCKED_OUT = 'Currently clocked out or missing previous clock in action';
export const WARNING_ENTRY_NOT_FOUND = 'Entry not found.';
export const CLOCK_OUT_ERROR = "Your 'clock out' action failed";
export const CLOCK_IN_ERROR = "Your 'clock in' action failed";
export const LOGIN_ERROR = 'Invalid Login Code';

export const defaultAutoEntry:BaseEntry = {
    idEmployee: 0,
    EntryDate: '',
    idEntryType: ENTRY_TYPES.AUTOMATIC,
    Duration: 0,
    idUser: 0,
}
