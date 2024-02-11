import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

export async function getTestFileAsBuffer(filename: string) {
  const path = resolve(__dirname, `../`, 'files', filename)

  const fileContent = await readFile(path)

  return fileContent
}
