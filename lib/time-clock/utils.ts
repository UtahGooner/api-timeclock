import Debug from 'debug';
import {Entry, EntryAction, EntryWeek} from "../types";
import {
    CLOCK_IN_ACTION,
    CLOCK_OUT_ACTION,
    DEFAULT_WEEK,
    ENTRY_TYPES,
    MISSING_CLOCK_MAX_HOURS,
    STD_HOURS
} from "./constants.js";
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

export async function parseWeekTotals(rows: Entry[] = [], excludeAuto:boolean = false): Promise<EntryWeek[]> {
    try {
        const weeks: EntryWeek[] = [{...DEFAULT_WEEK}, {...DEFAULT_WEEK}];
        if (rows.length === 0) {
            weeks[0].Approved = false;
            weeks[1].Approved = false;
            weeks[0].EmployeeApproved = false;
            weeks[1].EmployeeApproved = false;
        }

        rows.filter(row => !row.deleted)
            .filter(row => !excludeAuto || row.idEntryType !== ENTRY_TYPES.AUTOMATIC)
            .forEach(row => {
                const weekIndex = row.Week || 0;
                const week = weeks[weekIndex];
                week.Duration += row.Duration;
                if (week.Duration > STD_HOURS) {
                    week.Overtime = week.Duration - STD_HOURS;
                }
                week.hasErrors ||= row.errors.length > 0;

                week.Approved = week.Approved && !!row.Approved;
                week.ApprovedBy = week.Approved ? row.ApprovedBy : 0;
                week.ApprovalTime = week.Approved ? row.ApprovalTime : null;

                week.EmployeeApproved &&= !!row.EmployeeApproved;
                week.EmployeeApprovalTime ||= row.EmployeeApprovalTime;
                if (row.idEntryType === ENTRY_TYPES.TIMECLOCK) {
                    week.isClockedIn ||= !!row.isClockedIn;
                }
                if (row.idEntryType === ENTRY_TYPES.PERSONAL_LEAVE) {
                    week.PersonalLeaveDuration += row.Duration;
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


export const actionSorter = (field: keyof EntryAction, ascending: boolean = true) =>
    (a:EntryAction, b:EntryAction) => {
        return (a[field] === b[field]
            ? a.id - b.id
            : (a[field] > b[field] ? 1 : -1)
        ) * (ascending ? 1 : -1);
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

                // return latest clock in action or clock in adjustment
                const [clockInAction] = row.actions.filter(action => action.actionType & CLOCK_IN_ACTION).sort(actionSorter('id', false));

                // return latest clock out action or clock out adjustment
                const [clockOutAction] = row.actions.filter(action => action.actionType & CLOCK_OUT_ACTION).sort(actionSorter('id', false));

                if (!!clockInAction && !!clockOutAction) {
                    // employee clocked in and out (or has been adjusted), so all ok
                    return row;
                }
                if (!clockInAction && !clockOutAction) {
                    // hasn't happened yet, not likely to happen
                    row.errors.push('This entry is missing all clock in and clock out entries');
                }

                if (!clockInAction) {
                    // employee forgot to clock in and hasn't been adjusted
                    row.errors.push('This entry is missing a clock in action');
                    return row;
                }
                // Employee must be clocked in, so look for future entries to indicate they clocked in/out after this entry
                const clockInTime = new Date(clockInAction.time);
                const futureEntries = rows.filter(entry => {
                    return entry.idEntryType === ENTRY_TYPES.TIMECLOCK
                        && entry.id !== id
                        && new Date(entry.EntryDate) > clockInTime
                });
                // if there are future entries or the max hours have past, then mark as error;
                if (!!futureEntries.length ||  addHours(clockInTime, MISSING_CLOCK_MAX_HOURS) < now) {
                    row.isClockedIn = false;
                    row.errors.push('This entry is missing a clock out action');
                    return row;
                }

                // all ok, employee is still clocked in.
                row.Duration = Math.round((now.valueOf() - clockInTime.valueOf()) / 1000);
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

export const changeRequiresApproval = (from:number, to:number):boolean => {
    if (from === to) {
        return false;
    }
    switch (from) {
    case ENTRY_TYPES.HOLIDAY:
        return ![ENTRY_TYPES.MED_ASSIST, ENTRY_TYPES.BEREAV_JURY, ENTRY_TYPES.MANUAL].includes(to);
    case ENTRY_TYPES.PERSONAL_LEAVE:
        return ![ENTRY_TYPES.HOLIDAY, ENTRY_TYPES.BEREAV_JURY, ENTRY_TYPES.MED_ASSIST].includes(to);
    case ENTRY_TYPES.MED_ASSIST:
        return ![ENTRY_TYPES.MANUAL, ENTRY_TYPES.HOLIDAY].includes(to);
    }
    return true;
}
