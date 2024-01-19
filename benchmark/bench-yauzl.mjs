import yauzl from 'yauzl';

let filesRead = 0;

const start = performance.now();
yauzl.open('./test.zip', { lazyEntries: false, autoClose: true }, (error, zipFile) => {
  if (error) {
    console.error(error);
    process.exit(1);
  }

  zipFile.on('entry', (entry) => {
    filesRead++;
  });

  zipFile.on('end', () => {
    console.log(`Files Read: ${filesRead}`);
    console.log(`Took: ${performance.now() - start}ms`);
    console.log(`Memory: ${process.memoryUsage.rss() / 1024 / 1024}MB`);
  })
});
