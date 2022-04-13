import Debug from 'debug';
import {Entry, EntryAction, EntryWeek} from "../types";
import {
    CLOCK_IN_ACTION,
    CLOCK_OUT_ACTION,
    DEFAULT_WEEK,
    ENTRY_TYPES,
    MISSING_CLOCK_MAX_HOURS,
    STD_HOURS
} from "./settings.js";
import {addHours} from "date-fns";

const debug = Debug('chums:lib:time-clock:utils');

export function isClockedIn(actions: EntryAction[] = []): boolean {
    return actions
            .filter(action => (action.actionType & CLOCK_IN_ACTION) === CLOCK_IN_ACTION)
            .length > 0
        && actions
            .filter(action => (action.actionType & CLOCK_OUT_ACTION) === CLOCK_OUT_ACTION)
            .length === 0;
}

export async function parseWeekTotals(rows: Entry[] = []): Promise<EntryWeek[]> {
    try {
        const weeks: EntryWeek[] = [{...DEFAULT_WEEK}, {...DEFAULT_WEEK}];
        if (rows.length === 0) {
            weeks[0].Approved = false;
            weeks[1].Approved = false;
            weeks[0].EmployeeApproved = false;
            weeks[1].EmployeeApproved = false;
        }

        rows.filter(row => !row.deleted)
            .forEach(row => {
                const week = row.Week || 0;
                weeks[week].Duration += row.Duration;
                if (weeks[week].Duration > STD_HOURS) {
                    weeks[week].Overtime = weeks[week].Duration - STD_HOURS;
                }
                weeks[week].hasErrors ||= row.errors.length > 0;

                weeks[week].Approved = weeks[week].Approved && !!row.Approved;
                weeks[week].ApprovedBy ||= row.ApprovedBy;
                weeks[week].ApprovalTime ||= row.ApprovalTime;

                weeks[week].EmployeeApproved &&= !!row.EmployeeApproved;
                weeks[week].EmployeeApprovalTime ||= row.EmployeeApprovalTime;
                if (row.idEntryType === ENTRY_TYPES.TIMECLOCK) {
                    weeks[week].isClockedIn ||= !!row.isClockedIn;
                }
                if (row.idEntryType === ENTRY_TYPES.PERSONAL_LEAVE) {
                    weeks[week].PersonalLeaveDuration += row.Duration;
                }
            });

        return weeks;
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("parseWeeks()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('parseWeeks()'));
    }
}

export function entrySorter(a: Entry, b: Entry): number {
    return new Date(a.EntryDate).valueOf() - new Date(b.EntryDate).valueOf();
}


export async function validateEntries(rows: Entry[] = []): Promise<Entry[]> {
    try {
        const now = new Date();
        return rows
            .sort(entrySorter)
            .map(row => {
                row.errors = [];
                if (row.idEntryType !== ENTRY_TYPES.TIMECLOCK || row.deleted) {
                    return row;
                }

                const id = row.id;
                const clockInTime = new Date(row.EntryDate);
                const futureEntries = rows.filter(row => row.idEntryType === 1 && row.id !== id && new Date(row.EntryDate) > clockInTime);

                if (row.isClockedIn && (!!futureEntries.length || addHours(clockInTime, MISSING_CLOCK_MAX_HOURS) < now)) {
                    row.isClockedIn = false;
                    row.errors.push('This entry is missing a clock out action');
                    return row;
                }
                if (!row.isClockedIn && row.actions.filter(action => action.actionType & CLOCK_IN_ACTION).length === 0) {
                    row.errors.push('This entry is missing a clock in action');
                    return row;
                }
                return row;
            });
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("validateEntries()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('validateEntries()'))
    }
}
