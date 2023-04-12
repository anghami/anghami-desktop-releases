import fetch from 'node-fetch';
import { getOctokit, context } from '@actions/github';

const UPDATE_TAG_NAME = 'anghami-desktop-updater';
const UPDATE_JSON_FILE = 'update.json';

/// generate update.json
/// upload to update tag's release asset
async function resolveUpdater() {
  if (process.env.GITHUB_TOKEN === undefined) {
    throw new Error('GITHUB_TOKEN is required');
  }

  const options = { owner: context.repo.owner, repo: context.repo.repo };
  const github = getOctokit(process.env.GITHUB_TOKEN);

  const { data: tags } = await github.rest.repos.listTags({
    ...options,
    per_page: 10,
    page: 1,
  });

  // get the latest publish tag
  const tag = tags.find((t) => t.name.startsWith('anghami-desktop-app-v'));

  console.log(tag);
  console.log();

  const { data: latestRelease } = await github.rest.repos.getReleaseByTag({
    ...options,
    tag: tag.name,
  });

  const updateData = {
    name: tag.name,
    notes: 'TODO',
    pub_date: new Date().toISOString(),
    platforms: {
      win64: { signature: '', url: '' }, // compatible with older formats
      linux: { signature: '', url: '' }, // compatible with older formats
      darwin: { signature: '', url: '' }, // compatible with older formats
      'darwin-aarch64': { signature: '', url: '' },
      'darwin-x86_64': { signature: '', url: '' },
      'linux-x86_64': { signature: '', url: '' },
      'windows-x86_64': { signature: '', url: '' },
    },
  };

  const setAsset = async (asset, reg, platforms) => {
    let sig = '';
    if (/.sig$/.test(asset.name)) {
      sig = await getSignature(asset.browser_download_url);
    }
    platforms.forEach((platform) => {
      if (reg.test(asset.name)) {
        // set sig
        if (sig) {
          updateData.platforms[platform].signature = sig;
          return;
        }
        // set download url
        updateData.platforms[platform].url = asset.browser_download_url;
      }
    });
  };

  const promises = latestRelease.assets.map(async (asset) => {
    console.log('>> release asset: ', asset);
    // windows
    await setAsset(asset, /.msi.zip/, ['win64', 'windows-x86_64']);

    // darwin
    await setAsset(asset, /.app.tar.gz/, [
      'darwin',
      'darwin-x86_64',
      'darwin-aarch64',
    ]);

    // linux
    await setAsset(asset, /.AppImage.tar.gz/, ['linux', 'linux-x86_64']);
  });

  await Promise.allSettled(promises);
  console.log(updateData);

  // maybe should test the signature as well
  // delete the null field
  Object.entries(updateData.platforms).forEach(([key, value]) => {
    if (!value.url) {
      console.log(`[Error]: failed to parse release for "${key}"`);
      delete updateData.platforms[key];
    }
  });

  const updateDataNew = JSON.parse(JSON.stringify(updateData));

  Object.entries(updateDataNew.platforms).forEach(([key, value]) => {
    if (value.url) {
      updateDataNew.platforms[key].url = value.url.replace(
        'https://github.com/',
      );
    } else {
      console.log(`[Error]: updateDataNew.platforms.${key} is null`);
    }
  });

  // update the update.json
  const { data: updateRelease } = await github.rest.repos.getReleaseByTag({
    ...options,
    tag: UPDATE_TAG_NAME,
  });

  // delete the old assets
  for (let asset of updateRelease.assets) {
    if (asset.name === UPDATE_JSON_FILE) {
      await github.rest.repos.deleteReleaseAsset({
        ...options,
        asset_id: asset.id,
      });
    }
  }

  // upload new assets
  await github.rest.repos.uploadReleaseAsset({
    ...options,
    release_id: updateRelease.id,
    name: UPDATE_JSON_FILE,
    data: JSON.stringify(updateData, null, 2),
  });
}

// get the signature file content
async function getSignature(url) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/octet-stream',
    },
  });

  return response.text();
}

resolveUpdater().catch(console.error);
