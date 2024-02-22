import { join } from 'node:path'
import { readFileSync } from 'fs'
import type { UnzipOptions } from '../lib/core/unzipomatic'

const readTestFileContent = (filename: string) => {
  try {
    return readFileSync(join(__dirname, './files', filename), 'utf8')
  } catch (e: unknown) {
    console.error(e)
    return (e as Error).message
  }
}

export type TestCase = {
  path: string;
  name: string;
  options?: UnzipOptions;
  expect: SuccessTestCase | FailureTestCase | FlakyTestCase
}

export type SuccessTestCase = {
  success: true;
  files: FileTestCase[]
};

export type FailureTestCase = {
  success: false;
  error: string;
};

export type FlakyTestCase = {
  success: 'flaky';
}

export type FileTestCase = {
  type: 'file';
  name: string;
  content: string;
} | {
  type: 'directory';
  name: string;
}

export const testCases: TestCase[] = [
  {
    path: join('./success/cygwin-info-zip.zip'),
    name: 'cygwin-info-zip.zip',
    expect: {
      success: true,
      files: [
        {
          type: 'file',
          name: 'a.txt',
          content: readTestFileContent('./success/cygwin-info-zip/a.txt')
        },
        {
          type: 'file',
          name: 'b.txt',
          content: readTestFileContent('./success/cygwin-info-zip/b.txt')
        }
      ]
    }
  },
  {
    path: join('./success/deflate.zip'),
    name: 'deflate.zip',
    expect: {
      success: true,
      files: [
        {
          type: 'file',
          name: 'index.js',
          content: readTestFileContent('./success/deflate/index.js')
        },
      ]
    }
  },
  {
    path: join('./success/directories.zip'),
    name: 'directories.zip',
    expect: {
      success: true,
      files: [
        {
          type: 'directory',
          name: 'a',
        },
        {
          type: 'directory',
          name: 'b',
        },
        {
          type: 'file',
          name: 'a/a.txt',
          content: readTestFileContent('./success/directories/a/a.txt'),
        },
      ],
    },
  },
  {
    path: join('./success/empty.zip'),
    name: 'empty.zip',
    expect: {
      success: true,
      files: []
    }
  },
  {
    path: join('./success/linux-info-zip.zip'),
    name: 'linux-info-zip.zip',
    expect: {
      success: true,
      files: [
        {
          type: 'file',
          name: 'a.txt',
          content: readTestFileContent('./success/linux-info-zip/a.txt'),
        },
        {
          type: 'file',
          name: 'b.txt',
          content: readTestFileContent('./success/linux-info-zip/b.txt'),
        }
      ]
    }
  },
  {
    path: join('./success/sloppy-filenames.zip'),
    name: 'sloppy-filenames.zip',
    expect: {
      success: true,
      files: [
        {
          type: 'file',
          name: 'a/txt',
          content: readTestFileContent('./success/sloppy-filenames/a/txt'),
        },
        {
          type: 'file',
          name: 'b.txt',
          content: readTestFileContent('./success/sloppy-filenames/b.txt'),
        }
      ]
    }
  },
  {
    path: join('./success/traditional-encryption.zip'),
    name: 'traditional-encryption.zip',
    expect: {
      success: true,
      files: [
        {
          type: 'file',
          name: 'a.txt',
          content: readTestFileContent('./success/traditional-encryption/a.txt'),
        },
      ]
    },
  },
  {
    path: join('./success/traditional-encryption-and-compression.zip'),
    name: 'traditional-encryption-and-compression.zip',
    options: { decompress: false },
    expect: {
      success: true,
      files: [
        {
          type: 'file',
          name: 'a.bin',
          content: readTestFileContent('./success/traditional-encryption-and-compression/a.bin'),
        },
      ]
    },
  },
  {
    path: join('./success/unicode.zip'),
    name: 'unicode.zip',
    expect: {
      success: true,
      files: [
        {
          type: 'file',
          name: 'Turmion Kätilöt/Hoitovirhe/Rautaketju.mp3',
          content: readTestFileContent('./success/unicode/Turmion Kätilöt/Hoitovirhe/Rautaketju.mp3'),
        },
        {
          type: 'file',
          name: 'Turmion Kätilöt/Pirun nyrkki/Mistä veri pakenee.mp3',
          content: readTestFileContent('./success/unicode/Turmion Kätilöt/Pirun nyrkki/Mistä veri pakenee.mp3'),
        },
      ]
    },
  },
  {
    path: join('./success/unicode-path-extra-field.zip'),
    name: 'unicode-path-extra-field.zip',
    expect: {
      success: true,
      files: [
        {
          type: 'file',
          name: '七个房间.txt',
          content: readTestFileContent('./success/unicode-path-extra-field/七个房间.txt'),
        },
      ]
    },
  },
  {
    path: join('./success/windows-7-zip.zip'),
    name: 'windows-7-zip.zip',
    expect: {
      success: true,
      files: [
        {
          type: 'file',
          name: 'a.txt',
          content: readTestFileContent('./success/windows-7-zip/a.txt'),
        },
        {
          type: 'file',
          name: 'b.txt',
          content: readTestFileContent('./success/windows-7-zip/b.txt'),
        },
      ]
    },
  },
  {
    path: join('./success/windows-compressed-folder.zip'),
    name: 'windows-compressed-folder.zip',
    expect: {
      success: true,
      files: [
        {
          type: 'file',
          name: 'a.txt',
          content: readTestFileContent('./success/windows-compressed-folder/a.txt'),
        },
        {
          type: 'file',
          name: 'b.txt',
          content: readTestFileContent('./success/windows-compressed-folder/b.txt'),
        },
      ]
    },
  },
  {
    path: join('./success/zip64.zip'),
    name: 'zip64.zip',
    expect: {
      success: true,
      files: [
        {
          type: 'file',
          name: 'test1.txt',
          content: readTestFileContent('./success/zip64/test1.txt'),
        },
        {
          type: 'file',
          name: 'test2.txt',
          content: readTestFileContent('./success/zip64/test2.txt'),
        },
      ]
    },
  },
  {
    path: join('./failure/absolute path atxt.zip'),
    name: 'absolute path atxt.zip',
    expect: {
      success: false,
      error: 'absolute path: /atxt',
    },
  },
  {
    path: join('./failure/absolute path C xt.zip'),
    name: 'absolute path C xt.zip',
    expect: {
      success: false,
      error: 'absolute path: C:/xt',
    },
  },
  {
    path: join('./failure/compressed uncompressed size mismatch for stored file 2147483647 5.zip'),
    name: 'compressed uncompressed size mismatch for stored file 2147483647 5.zip',
    expect: {
      success: false,
      error: 'compressed/uncompressed size mismatch for stored file: 2147483647 != 5',
    },
  },
  {
    path: join('./failure/end of central directory record signature not found.zip'),
    name: 'end of central directory record signature not found.zip',
    expect: {
      success: false,
      error: 'end of central directory record signature not found',
    },
  },
  {
    path: join('./failure/end of central directory record signature not found_1.zip'),
    name: 'end of central directory record signature not found_1.zip',
    expect: {
      success: false,
      error: 'end of central directory record signature not found',
    },
  },
  {
    path: join('./failure/expected zip64 extended information extra field.zip'),
    name: 'expected zip64 extended information extra field.zip',
    expect: {
      success: false,
      error: 'expected zip64 extended information extra field',
    },
  },
  {
    path: join('./failure/extra field length exceeds extra field buffer size.zip'),
    name: 'extra field length exceeds extra field buffer size.zip',
    expect: {
      success: false,
      error: 'extra field length exceeds extra field buffer size',
    },
  },
  {
    path: join('./failure/file data overflows file bounds 63 2147483647 308.zip'),
    name: 'file data overflows file bounds 63 2147483647 308.zip',
    expect: {
      success: false,
      error: 'file data overflows file bounds: 63 + 2147483647 > 308',
    },
  },
  {
    path: join('./failure/invalid central directory file header signature 0x1014b50.zip'),
    name: 'invalid central directory file header signature 0x1014b50.zip',
    expect: {
      success: false,
      error: 'invalid central directory file header signature: 0x1014b50',
    },
  },
  {
    path: join('./failure/invalid characters in fileName a txt.zip'),
    name: 'invalid characters in fileName a txt.zip',
    expect: {
      success: 'flaky',
    },
  },
  {
    path: join('./failure/invalid comment length expected 1 found 0.zip'),
    name: 'invalid comment length expected 1 found 0.zip',
    expect: {
      success: false,
      error: 'invalid comment length. expected: 1. found: 0',
    },
  },
  {
    path: join('./failure/invalid local file header signature 0x3034b50.zip'),
    name: 'invalid local file header signature 0x3034b50.zip',
    expect: {
      success: false,
      error: 'invalid local file header signature: 0x3034b50',
    },
  },
  {
    path: join('./failure/invalid relative path xt.zip'),
    name: 'invalid relative path xt.zip',
    expect: {
      success: false,
      error: 'invalid relative path: ../xt',
    },
  },
  {
    path: join('./failure/invalid zip64 end of central directory locator signature.zip'),
    name: 'invalid zip64 end of central directory locator signature.zip',
    expect: {
      success: false,
      error: 'invalid zip64 end of central directory locator signature',
    },
  },
  {
    path: join('./failure/invalid zip64 end of central directory record signature.zip'),
    name: 'invalid zip64 end of central directory record signature.zip',
    expect: {
      success: false,
      error: 'invalid zip64 end of central directory record signature',
    },
  },
  {
    path: join('./failure/multi-disk zip files are not supported found disk number 1.zip'),
    name: 'multi-disk zip files are not supported found disk number 1.zip',
    expect: {
      success: false,
      error: 'multi-disk zip files are not supported: found disk number: 1',
    },
  },
  {
    path: join('./failure/not enough bytes in the stream expected 2048576 got only 1000000.zip'),
    name: 'not enough bytes in the stream expected 2048576 got only 1000000.zip',
    expect: {
      success: 'flaky',
    },
  },
  {
    path: join('./failure/strong encryption is not supported.zip'),
    name: 'strong encryption is not supported.zip',
    expect: {
      success: false,
      error: 'strong encryption is not supported',
    },
  },
  {
    path: join('./failure/too many bytes in the stream expected 82496 got at least 98304.zip'),
    name: 'too many bytes in the stream expected 82496 got at least 98304.zip',
    expect: {
      success: 'flaky',
    },
  },
  {
    path: join('./failure/too many length or distance symbols.zip'),
    name: 'too many length or distance symbols.zip',
    expect: {
      success: 'flaky',
    },
  },
  {
    path: join('./failure/unsupported compression method 1.zip'),
    name: 'unsupported compression method 1.zip',
    expect: {
      success: false,
      error: 'unsupported compression method: 1',
    },
  },
  {
    path: join('./failure/zip64 extended information extra field does not include compressed size.zip'),
    name: 'zip64 extended information extra field does not include compressed size.zip',
    expect: {
      success: false,
      error: 'zip64 extended information extra field does not include compressed size',
    },
  },
  {
    path: join('./failure/zip64 extended information extra field does not include relative header offset.zip'),
    name: 'zip64 extended information extra field does not include relative header offset.zip',
    expect: {
      success: false,
      error: 'zip64 extended information extra field does not include relative header offset',
    },
  },
  {
    path: join('./failure/zip64 extended information extra field does not include uncompressed size.zip'),
    name: 'zip64 extended information extra field does not include uncompressed size.zip',
    expect: {
      success: false,
      error: 'zip64 extended information extra field does not include uncompressed size',
    },
  },
];
