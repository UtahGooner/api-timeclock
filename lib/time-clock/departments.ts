import Debug from 'debug';
import {mysql2Pool} from "chums-local-modules";
import {Department} from "../types";
import {RowDataPacket} from "mysql2";
import {Request, Response} from "express";

const debug = Debug('chums:lib:time-clock:departments');

interface DepartmentRow extends Department, RowDataPacket {
}

async function loadDepartments():Promise<Department[]> {
    try {
        const query = `SELECT Department, Description, active FROM timeclock.Department`;
        const [rows] = await mysql2Pool.query<DepartmentRow[]>(query);
        rows.forEach(row => row.active = !!row.active);
        return rows;
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("loadDepartments()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('Unknown error in loadDepartments()'));
    }
}

export const getDepartments = async (req: Request, res: Response) => {
    try {
        const departments = await loadDepartments();
        res.json({departments});
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("list()", err.message);
            res.status(500).json({error: err.message})
        }
        res.status(500).json({error: 'Unknown error in getDepartments()'})
    }
}
