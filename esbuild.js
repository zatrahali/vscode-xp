const { build } = require('esbuild');
const { clean } = require('esbuild-plugin-clean');
const fs = require('fs');
const path = require('path');

/** i18nCore reads taxonomy + few-shot JSON from __dirname/data (bundled next to extension.js). */
function copyI18nCoreDataToClientOut() {
  const srcData = path.join(__dirname, 'client', 'src', 'i18nCore', 'data');
  const outData = path.join(__dirname, 'client', 'out', 'data');
  if (!fs.existsSync(srcData)) {
    console.warn('[esbuild] client/src/i18nCore/data not found');
    return;
  }
  fs.mkdirSync(outData, { recursive: true });
  for (const name of ['taxonomy-fields.json', 'shots.json']) {
    const src = path.join(srcData, name);
    const dest = path.join(outData, name);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dest);
    }
  }
}

const baseConfig = {
  bundle: true,
  minify: process.env.NODE_ENV === 'production',
  sourcemap: process.env.NODE_ENV !== 'production'
};

const clientOutDirectoryPath = './client/out';
const clientConfig = {
  ...baseConfig,
  platform: 'node',
  mainFields: ['module', 'main'],
  format: 'cjs',
  entryPoints: ['./client/src/extension.ts'],
  outfile: `${clientOutDirectoryPath}/extension.js`,
  external: ['vscode', 'prettier'],
  plugins: [
    clean({
      patterns: [clientOutDirectoryPath]
    })
  ]
};

const uiConfig = {
  ...baseConfig,
  target: 'es2020',
  format: 'esm',
  entryPoints: ['./client/src/uiToolkit/ui.ts'],
  outfile: './client/out/ui.js'
};

const serverConfig = {
  ...baseConfig,
  platform: 'node',
  mainFields: ['module', 'main'],
  format: 'cjs',
  entryPoints: ['./server/src/server.ts'],
  outfile: './server/out/server.js',
  external: ['vscode']
};

const watchConfig = {
  watch: {
    onRebuild(error, result) {
      console.log('\x1b[33m[watch] \x1b[37mbuild \x1b[32mstarted\x1b[0m');
      if (error) {
        error.errors.forEach((error) =>
          console.error(
            `> ${error.location.file}:${error.location.line}:${error.location.column}: error: ${error.text}`
          )
        );
      } else {
        console.log('\x1b[33m[watch] \x1b[37mbuild \x1b[32mfinished\x1b[0m');
      }
    }
  }
};

(async () => {
  const args = process.argv.slice(2);
  console.log(process.argv);
  try {
    if (args.includes('--watch')) {
      console.log('\x1b[33m[watch] \x1b[37mbuild \x1b[32mstarted\x1b[0m');
      await build({
        ...clientConfig,
        ...watchConfig
      });
      copyI18nCoreDataToClientOut();
      await build({
        ...uiConfig,
        ...watchConfig
      });
      await build({
        ...serverConfig,
        ...watchConfig
      });
      console.log(
        '\x1b[33m[watch] \x1b[34mclient\x1b[37m, \x1b[35mui-toolkit\x1b[37m, \x1b[36mserver \x1b[37mbuild \x1b[32mfinished\x1b[0m\n'
      );
    } else {
      await build(clientConfig);
      copyI18nCoreDataToClientOut();
      console.log('\x1b[32m✓ \x1b[34mclient \x1b[37mbuild \x1b[32mcomplete\x1b[0m');
      await build(uiConfig);
      console.log('\x1b[32m✓ \x1b[35mui-toolkit \x1b[37mbuild \x1b[32mcomplete\x1b[0m');
      await build(serverConfig);
      console.log('\x1b[32m✓ \x1b[36mserver \x1b[37mbuild \x1b[32mcomplete\x1b[0m');
    }
  } catch (err) {
    process.stderr.write(err.stderr);
    process.exit(1);
  }
})();
