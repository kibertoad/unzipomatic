import { createWriteStream } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import type {Readable} from "node:stream";
import { pipeline } from "node:stream/promises";

import type { Entry } from '../yauzl-ts/Entry'
import type { ZipFile } from '../yauzl-ts/ZipFile'
import { fromBuffer } from '../yauzl-ts/inputProcessors'


export type UnzipOptions = {
    // ToDo, but I would start with making yauzl defaults non-configureable and see if there is demand for flexibility there
}

export type SourceType = string | File | Blob | Buffer | Readable

export type TargetFileMetadata = {
    fullPath: string
    fileSize: number
}

// ToDo
export type FileGenerator = Generator<Entry, void, void>

export async function unzipToFilesystem(source: SourceType, targetDir: string, options: UnzipOptions): Promise<TargetFileMetadata> {
    if (!Buffer.isBuffer(source)) {
        throw new Error('Only buffer is currently supported');
    }

    const fileWrites: Promise<any>[] = []; // Array to track file write promises

    const result = await new Promise(async (resolve, reject) => {
        const zipfile  = await new Promise<ZipFile>((resolve, reject) => {
            fromBuffer(source, { lazyEntries: true }, (err, result) => {
                if (err) return reject(err);
                resolve(result);
            });
        });

        zipfile.on('entry', async (entry) => {
            if (/\/$/.test(entry.fileName)) {
                // Directory: create if doesn't exist
                const directoryPath = join(targetDir, entry.fileName);
                await mkdir(directoryPath, { recursive: true });
                zipfile.readEntry();
            } else {
                // File: extract
                zipfile.openReadStream(entry, { decrypt: entry.isEncrypted() ? true : undefined }, (err, readStream) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    const filePath = join(targetDir, entry.fileName);
                    fileWrites.push((async () => {
                        await mkdir(dirname(filePath), { recursive: true });
                        await pipeline(readStream, createWriteStream(filePath)); // Use pipeline for proper error handling
                    })());

                    readStream.on('end', () => {
                        zipfile.readEntry();
                    });
                });
            }
        });

        zipfile.on('end', async () => {
            // Wait for all file writes to complete
            await Promise.all(fileWrites);
            resolve(undefined);
        });

        zipfile.on('error', (err) => {
            reject(err);
        });

        zipfile.readEntry();
    });

    return {
        fullPath: 'dummy', // Adjust as needed
        fileSize: 444, // Adjust as needed
    };
}

/**
 * Used to iterate over multiple files in an archive
 */
export function unzipToReadableGenerator(source: SourceType, options: UnzipOptions): Promise<FileGenerator>

/**
 * Used to extract a single-file archive
 */
export function unzipToReadable(source: SourceType, options: UnzipOptions): Promise<Readable>

/**
 * Used to extract a single-file archive
 */
export function unzipToBuffer(source: SourceType, options: UnzipOptions): Promise<Buffer>

// TBD
// Do we need to support filters for extracting just a subset of files?
//
