import Debug from 'debug';
import {mysql2Pool} from "chums-local-modules";
import {RowDataPacket} from "mysql2";
import {PRImportData, PRImportLine} from "../types";
import {Request, Response} from "express";
import {loadPayPeriodImportData} from "../time-clock/pay-periods.js";



interface PREarningWrk {
    EarningsCode: string,
    EarningsType: string,
    weeks: [{ seconds: number }, { seconds: number }]
}

interface PREmployeeEarnings {
    [key: string]: PREarningWrk,
}

interface PRImportEmployeeWrk {
    EmployeeKey: string,
    Department: string,
    EmployeeNumber: string,
    PayMethod: string,
    days: string[],
    weeks: number[],
    earnings: PREmployeeEarnings,
    WeeksWorked?: number,
    DaysWorked?: number,
}

interface PRImportEmployees {
    [key: string]: PRImportEmployeeWrk
}

const debug = Debug('chums:lib:payroll:sage-export');


const EARNINGS_CODE_REGULAR = '000001';
const EARNINGS_CODE_OVERTIME = '000002';
const EARNINGS_CODE_PERSONAL_LEAVE = '000004';
const EARNINGS_TYPE_OVERTIME = 'O';

const SECS_PER_WEEK = 40 * 60 * 60;


async function parsePayPeriodImportEntries(idPayPeriod: number | string):Promise<{lines: PRImportLine[], employees: PRImportEmployees, rows: PRImportData[]}> {
    try {
        const rows = await loadPayPeriodImportData(idPayPeriod);

        // build a list of weeks
        const weeks: number[] = [];
        rows.forEach(row => {
            row.seconds = Number(row.seconds || 0) || 0;
            if (row.WeekWorked === 0) {
                row.WeekWorked = 53;
            }
            if (!weeks.includes(row.WeekWorked)) {
                weeks.push(row.WeekWorked);
            }
        });

        debug('loadPayPeriodEntries()', 'building employees', rows.length);
        const employees: PRImportEmployees = {};
        rows.forEach(row => {
            const {
                EmployeeKey,
                Department,
                EmployeeNumber,
                PayMethod,
                DayWorked,
                WeekWorked,
                EarningsCode,
                EarningsType,
                seconds
            } = row;
            if (employees[EmployeeKey] === undefined) {
                employees[EmployeeKey] = {
                    EmployeeKey,
                    Department,
                    EmployeeNumber,
                    PayMethod,
                    days: [],
                    weeks: [],
                    earnings: {}
                };
            }
            if (EarningsCode === EARNINGS_CODE_REGULAR && !employees[EmployeeKey].days.includes(DayWorked)) {
                employees[EmployeeKey].days.push(DayWorked);
            }
            if ((EarningsCode === EARNINGS_CODE_REGULAR || EarningsCode === EARNINGS_CODE_PERSONAL_LEAVE) && !employees[EmployeeKey].weeks.includes(WeekWorked)) {
                employees[EmployeeKey].weeks.push(WeekWorked);
            }
            if (!employees[EmployeeKey].earnings[EarningsCode]) {
                employees[EmployeeKey].earnings[EarningsCode] = {
                    EarningsCode,
                    EarningsType,
                    weeks: [{seconds: 0}, {seconds: 0}]
                };
            }
            const weekIndex = weeks.indexOf(WeekWorked);
            if (employees[EmployeeKey].earnings[EarningsCode].weeks[weekIndex]) {
                employees[EmployeeKey].earnings[EarningsCode].weeks[weeks.indexOf(WeekWorked)].seconds += seconds;
            } else {
                throw new Error(`Error in row ${EmployeeKey}/${EarningsCode}/${WeekWorked}`);
            }
        });


        debug('loadPayPeriodEntries()', 'parsing employees');
        Object.keys(employees)
            .forEach(key => {
                employees[key].WeeksWorked = employees[key].weeks.length;
                employees[key].DaysWorked = employees[key].days.length;

                // split out overtime into correct overtime code.
                if (employees[key].PayMethod === 'H') {
                    Object.keys(employees[key].earnings)
                        .forEach(eKey => {
                            [0, 1].forEach(week => {
                                if (employees[key].earnings[eKey].weeks[week].seconds > SECS_PER_WEEK) {
                                    if (employees[key].earnings[EARNINGS_CODE_OVERTIME] === undefined) {
                                        employees[key].earnings[EARNINGS_CODE_OVERTIME] = {
                                            EarningsCode: EARNINGS_CODE_OVERTIME,
                                            EarningsType: EARNINGS_TYPE_OVERTIME,
                                            weeks: [{seconds: 0}, {seconds: 0}]
                                        }
                                    }
                                    employees[key].earnings[EARNINGS_CODE_OVERTIME].weeks[week].seconds = employees[key].earnings[eKey].weeks[week].seconds - SECS_PER_WEEK;
                                    employees[key].earnings[eKey].weeks[week].seconds = SECS_PER_WEEK;
                                }
                            })
                        })
                } else {
                    // make the salary people days worked more accurate
                    if (!!employees[key].earnings[EARNINGS_CODE_REGULAR]) {
                        const seconds = (employees[key].earnings[EARNINGS_CODE_REGULAR].weeks[0].seconds || 0)
                            + (employees[key].earnings[EARNINGS_CODE_REGULAR].weeks[0].seconds || 0);
                        employees[key].DaysWorked = Math.ceil((seconds / 3600) / 8); // number of 8 hour days
                    }
                }
            })


        const lines:PRImportLine[] = [];

        debug('loadPayPeriodEntries()', 'building import');
        Object.keys(employees).forEach(key => {
            const {EmployeeKey, WeeksWorked = 0, DaysWorked = 0, earnings} = employees[key];
            Object.keys(earnings).forEach(eKey => {
                const {EarningsCode, EarningsType, weeks} = earnings[eKey];
                let seconds = 0;
                weeks.forEach(week => {
                    if (week.seconds > 0) {
                        seconds += week.seconds;
                    }
                })
                lines.push({
                    EmployeeKey,
                    WeeksWorked,
                    DaysWorked,
                    EarningsCode,
                    EarningsType,
                    hours: Math.round((seconds / 3600) * 100) / 100
                })
            })
        });

        return {
            lines,
            employees,
            rows,
        }
    } catch (err:unknown) {
        if (err instanceof Error) {
            debug("loadPayPeriodEntries()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('Error in load '))
    }
}

export async function getExport(req:Request, res:Response) {
    try {
        const result = await parsePayPeriodImportEntries(req.params.idPayPeriod);
        res.json({result});
    } catch(err:unknown) {
        if (err instanceof Error) {
            debug("getExport()", err.message);
            return res.json({error: err.message, name: err.name});
        }
        res.json({error: 'unknown error in getExport'});
    }
}

export async function testPRImportFile(req:Request, res:Response) {
    try {
        const {rows} = await parsePayPeriodImportEntries(req.params.idPayPeriod);
        res.json(rows);
    } catch(err:unknown) {
        if (err instanceof Error) {
            debug("testExportDownload()", err.message);
            return res.json({error: err.message, name: err.name});
        }
        res.json({error: 'unknown error in testExportDownload'});
    }
}

const importSorter = (a:PRImportLine, b:PRImportLine) => {
    return a.EmployeeKey === b.EmployeeKey
        ? (a.EarningsCode === b.EarningsCode
                ? 0
                : (a.EarningsCode > b.EarningsCode ? 1 : -1)
        )
        : (a.EmployeeKey > b.EmployeeKey ? 1 : -1);
}


export async function getPRImportFile(req:Request, res:Response) {
    try {
        const {lines} = await parsePayPeriodImportEntries(req.params.idPayPeriod);
        const rows = lines.sort(importSorter);
        const csv:string[] = [];
        /*
        It appears that the batch is always '00001', so setting that as a constant instead of fetching from Sage
        const url = `https://intranet.chums.com/node-sage/api/TST/payroll/current-batch`;
         */
        const BatchNo = '00001';
        const LineType = 'E';
        rows.forEach(row => {
            const {EmployeeKey, WeeksWorked, DaysWorked, EarningsCode, EarningsType, hours} = row;
            csv.push([EmployeeKey, '1', BatchNo, WeeksWorked, DaysWorked, LineType, EarningsCode, hours.toString()].join('\t'));
        })

        res.header('Content-Type', 'text/tab-separated-values');
        res.attachment(`PayPeriod-Import-${req.params.id}.txt`);
        res.send(csv.join('\n'));
    } catch(err:unknown) {
        if (err instanceof Error) {
            debug("getExportDownload()", err.message);
            return res.json({error: err.message, name: err.name});
        }
        res.json({error: 'unknown error in getExportDownload'});
    }
}

export async function getPayPeriodSpreadsheet(req:Request, res:Response) {
    try {
        const ppe = await parsePayPeriodImportEntries(req.params.idPayPeriod);
        res.json(ppe);
    } catch(err:unknown) {
        if (err instanceof Error) {
            debug("getPayPeriodSpreadsheet()", err.message);
            return res.json({error: err.message, name: err.name});
        }
        res.json({error: 'unknown error in getPayPeriodSpreadsheet'});
    }
}
