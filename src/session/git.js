import git from 'isomorphic-git';
import fs from 'fs';

export async function getGitChanges(targetPath, baselineTimestamp) {
  try {
    const toCommitHash = await git.resolveRef({ fs, dir: targetPath, ref: 'HEAD' });

    // Get commits since baseline
    const logOpts = { fs, dir: targetPath, depth: 500 };
    if (baselineTimestamp) {
      logOpts.since = new Date(baselineTimestamp.replace(' ', 'T') + 'Z');
    }

    const commits = await git.log(logOpts);
    const truncated = commits.length === 500;

    const fromCommitHash = commits.length > 0 ? commits[commits.length - 1].oid : null;

    // Build commit list
    const commitList = commits.map(c => ({
      hash: c.oid,
      message: c.commit.message.trim(),
      author: c.commit.author.name,
      timestamp: new Date(c.commit.author.timestamp * 1000).toISOString(),
    }));

    // Get changed files from commits
    const changedFilesMap = new Map(); // path → status
    const fileAuthors = new Map(); // path → Set<author>

    for (const commit of commits) {
      const parentOid = commit.commit.parent[0];
      if (!parentOid) continue;

      let parentTree, commitTree;
      try {
        parentTree = await git.readTree({ fs, dir: targetPath, oid: parentOid });
        commitTree = await git.readTree({ fs, dir: targetPath, oid: commit.oid });
      } catch {
        continue;
      }

      const parentFiles = await flattenTree(fs, targetPath, parentTree.tree, '');
      const commitFiles = await flattenTree(fs, targetPath, commitTree.tree, '');

      const author = commit.commit.author.name;

      for (const [filePath, oid] of commitFiles) {
        const parentOidForFile = parentFiles.get(filePath);
        if (!parentOidForFile) {
          if (!changedFilesMap.has(filePath)) changedFilesMap.set(filePath, 'added');
        } else if (parentOidForFile !== oid) {
          if (!changedFilesMap.has(filePath)) changedFilesMap.set(filePath, 'modified');
        }
        if (!fileAuthors.has(filePath)) fileAuthors.set(filePath, new Set());
        fileAuthors.get(filePath).add(author);
      }

      for (const [filePath] of parentFiles) {
        if (!commitFiles.has(filePath)) {
          if (!changedFilesMap.has(filePath)) changedFilesMap.set(filePath, 'deleted');
          if (!fileAuthors.has(filePath)) fileAuthors.set(filePath, new Set());
          fileAuthors.get(filePath).add(author);
        }
      }
    }

    // Also check working-tree uncommitted changes
    const statusMatrix = await git.statusMatrix({ fs, dir: targetPath });
    for (const [filepath, head, workdir, stage] of statusMatrix) {
      // head: 0=absent, 1=present; workdir: 0=absent, 1=identical, 2=modified
      if (head === 0 && workdir === 2) {
        if (!changedFilesMap.has(filepath)) changedFilesMap.set(filepath, 'added');
      } else if (head === 1 && workdir === 0) {
        if (!changedFilesMap.has(filepath)) changedFilesMap.set(filepath, 'deleted');
      } else if (head === 1 && workdir === 2) {
        if (!changedFilesMap.has(filepath)) changedFilesMap.set(filepath, 'modified');
      }
    }

    const changedFiles = Array.from(changedFilesMap.entries()).map(([path, status]) => ({ path, status }));
    const fileAuthorsResolved = new Map(
      Array.from(fileAuthors.entries()).map(([k, v]) => [k, Array.from(v)])
    );

    const meta = { warnings: [] };
    if (truncated) meta.warnings.push('commit_log_truncated_at_500');

    return {
      changedFiles,
      fileAuthors: fileAuthorsResolved,
      commits: commitList,
      fromCommitHash,
      toCommitHash,
      meta,
    };
  } catch (err) {
    return {
      changedFiles: [],
      fileAuthors: new Map(),
      commits: [],
      fromCommitHash: null,
      toCommitHash: null,
      error: 'no_git',
      errorDetail: err.message,
    };
  }
}

async function flattenTree(fs, dir, treeEntries, prefix) {
  const result = new Map();
  for (const entry of treeEntries) {
    const entryPath = prefix ? `${prefix}/${entry.path}` : entry.path;
    if (entry.type === 'blob') {
      result.set(entryPath, entry.oid);
    } else if (entry.type === 'tree') {
      try {
        const sub = await git.readTree({ fs, dir, oid: entry.oid });
        const subEntries = await flattenTree(fs, dir, sub.tree, entryPath);
        for (const [k, v] of subEntries) result.set(k, v);
      } catch {
        // skip unreadable subtrees
      }
    }
  }
  return result;
}
