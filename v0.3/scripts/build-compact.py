#!/usr/bin/env python3
"""Create an explicit, private-data-free build context using cached dependencies."""
from pathlib import Path
import shutil, json, hashlib
root=Path(__file__).resolve().parents[1]
context=root/'.runtime/compact/context'
if context.exists(): shutil.rmtree(context)
context.mkdir(parents=True)
exclude=shutil.ignore_patterns('.runtime','.secrets','.git','node_modules','dist','__pycache__','*.tsbuildinfo','.env','.DS_Store')
shutil.copytree(root,context/'app',ignore=exclude,symlinks=True)
shutil.copytree(root.parent/'v0.2/node_modules',context/'node_modules',symlinks=True)
for name in ['design','log']:
    shutil.copytree(root.parent/name,context/'reference'/name,ignore=exclude,symlinks=True)
# Historical application source is recoverable without retaining its containers.
for name in ['v0.1','v0.2']:
    path=root.parent/name
    if path.is_dir(): shutil.copytree(path,context/'reference'/name,ignore=exclude,symlinks=True)
shutil.copyfile(root/'Dockerfile.compact',context/'Dockerfile')
manifest=[]
for path in sorted((context/'app').rglob('*')):
    if path.is_file() and not path.is_symlink():
        manifest.append({'path':str(path.relative_to(context/'app')),'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
(context/'app/compact-source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(f'Prepared {len(manifest)} application files and existing dependencies at {context}')
