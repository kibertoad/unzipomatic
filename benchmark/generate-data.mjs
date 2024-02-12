import { writeFileSync } from 'node:fs'

function randomLargeString() {
  let str = ''

  for (let i = 0; i < 1_000; i++) {
    str += Math.random().toString(16).slice(2)
  }

  return str
}

for (let i = 0; i < 20_000; i++) {
  const randomText = randomLargeString()

  writeFileSync(`./test-files/${i}.txt`, randomText, {
    encoding: 'utf-8',
  })
}
