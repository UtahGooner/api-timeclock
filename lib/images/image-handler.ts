import {handleUpload, mysql2Pool} from 'chums-local-modules';
import Debug from 'debug';
import sharp from 'sharp';
import {readFile, rename, unlink, writeFile} from 'node:fs/promises';
import * as path from 'node:path';
import {BannerImage} from "../types";
import {Request, Response} from "express";
import {RowDataPacket} from "mysql2";

const debug = Debug('chums:lib:images:image-handler');

const FS_PATH: string = '/var/www/intranet.chums.com';
const BASE_PATH: string = '/timeclock';
const UPLOAD_PATH: string = BASE_PATH + '/temp';
const IMG_PATH: string = BASE_PATH + '/images';
const IMG_SIZE: number = 250;

interface BannerImageRow extends BannerImage, RowDataPacket {
}

async function getMetadata(filename: string): Promise<sharp.Metadata> {
    try {
        const img = await readFile(`${IMG_PATH}/${filename}`);
        return await sharp(img).metadata();
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("getMetadata()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('Unknown error on getMetadata()'));
    }
}

async function makeThumb(filename: string): Promise<string> {
    try {
        const img = await readFile(`${path.join(FS_PATH, UPLOAD_PATH)}/${filename}`);
        const resized = await sharp(img)
            .resize({width: IMG_SIZE, height: IMG_SIZE, fit: sharp.fit.contain, background: '#FFFFFF'})
            .toBuffer();
        await writeFile(`${path.join(FS_PATH, IMG_PATH)}/${filename}`, resized);
        await unlink(`${path.join(FS_PATH, UPLOAD_PATH)}/${filename}`);
        return `${IMG_PATH}/${filename}`;
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("makeThumb()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('Unknown error on makeThumb()'));
    }
}

interface addImageProps {
    filename: string,
}

async function addImage({filename}: addImageProps): Promise<BannerImage[]> {
    try {
        const queryInsert = `INSERT INTO timeclock.banner (filename, active) VALUES (:filename, 1)`;
        const [banner] = await loadBanners({filename});
        if (!banner) {
            await mysql2Pool.query(queryInsert, {filename});
            return await loadBanners({filename});
        }
        return Promise.reject(new Error('An image with this filename already exists.'))
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("addImage()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('Unknown error on addImage()'));
    }
}

interface loadBannerProps {
    id?: number | string,
    filename?: string,
}

async function loadBanners({id, filename}: loadBannerProps = {}): Promise<BannerImage[]> {
    try {
        const query = `SELECT id, filename, overlay, active
                       FROM timeclock.banner
                       WHERE (NULLIF(:id, 0) = id)
                          OR (NULLIF(:filename, '') = filename)
                          OR (:id IS NULL AND :filename IS NULL)
                       ORDER BY id`;
        const [rows] = await mysql2Pool.query<BannerImageRow[]>(query, {id, filename});
        rows.forEach(row => {
            row.active = !!row.active;
        });

        return rows;
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("getImages()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(err);
    }
}


async function loadActiveBanners(): Promise<BannerImage[]> {
    try {
        const rows = await loadBanners();
        return rows.filter(row => row.active);
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("getImages()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(err);
    }
}

async function updateBanner({id, filename, overlay, active}: BannerImage): Promise<BannerImage[]> {
    try {
        const [banner] = await loadBanners({id, filename});
        if (!banner) {
            const queryInsert = `INSERT INTO timeclock.banner (filename, overlay, active)
                                 VALUES (:filename, :overlay, :active)`;
            await mysql2Pool.query(queryInsert, {filename, overlay, active})
            return await loadBanners({id, filename});
        }
        const queryUpdate = `UPDATE timeclock.banner
                             SET overlay = :overlay,
                                 active  = :active
                             WHERE id = :id`;
        const data = {id, overlay, active};
        await mysql2Pool.query(queryUpdate, data);
        return await loadBanners({id});
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("updateImage()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('Unknown error in updateBanner()'));
    }
}

export interface RemoveBannerProps {
    id: number | string
}

async function removeBanner({id}: RemoveBannerProps): Promise<BannerImage[]> {
    try {
        const query = `DELETE FROM timeclock.banner WHERE id = :id`;
        const data = {id};
        await mysql2Pool.query(query, data);
        return await loadBanners();
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("removeImage()", err.message);
            return Promise.reject(err);
        }
        return Promise.reject(new Error('Unknown error on removeBanner'));
    }
}

export const uploadBanner = async (req: Request, res: Response) => {
    try {
        const file = await handleUpload(req, {uploadPath: path.join(FS_PATH, UPLOAD_PATH)});
        if (!file) {
            return res.json({error: 'Image upload failed'});
        }
        const filename = file.originalFilename || file.newFilename;
        await rename(file.filepath, path.join(FS_PATH, IMG_PATH, filename));
        await makeThumb(filename);
        const img = `${UPLOAD_PATH}/${filename}`;
        const image = await addImage({filename});
        res.json({...file, img, image});
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("upload()", err.message);
            return res.json({error: err.message, name: err.name});
        }
        return res.json({error: 'Unknown error on uploadBanner()'});
    }
};

export const getBanners = async (req: Request, res: Response) => {
    try {
        const banners = await loadBanners(req.params);
        return res.json({banners});
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("get()", err.message);
            return res.json({error: err.message, name: err.name});
        }
        return res.json({error: 'Unknown error on getBanners'});
    }
};

export const getActiveBanners = async (req: Request, res: Response) => {
    try {
        const banners = await loadActiveBanners();
        return res.json({banners});
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("get()", err.message);
            return res.json({error: err.message, name: err.name});
        }
        return res.json({error: 'Unknown error on getActiveBanners'});
    }
};

export const postBanner = async (req: Request, res: Response) => {
    try {
        const banners = await updateBanner(req.body);
        res.json({banners});
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug("postBanner()", err.message);
            return res.json({error: err.message, name: err.name})
        }
        return res.json({error: 'Unknown error on postBanner'});
    }
}

export const deleteBanner = async (req: Request, res: Response) => {
    try {
        const banners = await removeBanner(req.params as unknown as RemoveBannerProps);
        res.json({banners});
    } catch (err: unknown) {
        if (err instanceof Error) {
            debug('deleteBanner()', err.message);
            res.json({error: err.message, name: err.name});
        }
        return res.json({error: 'Unknown error on deleteBanner'});
    }
};
