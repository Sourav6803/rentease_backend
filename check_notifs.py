import re, os

valid_types = {'email', 'sms', 'push', 'in_app', 'whatsapp'}
valid_cats = {'transactional', 'promotional', 'alert', 'reminder', 'update', 'security', 'marketing', 'system'}

root = 'D:/RentEase/backend/src'
issues = []
for dirpath, _, files in os.walk(root):
    for f in files:
        if not f.endswith('.js'):
            continue
        p = os.path.join(dirpath, f)
        src = open(p, encoding='utf-8', errors='ignore').read()
        for m in re.finditer(r"addJob\('notification',\s*'create',\s*\{", src):
            # find balanced block up to first closing of the literal (approx)
            start = m.end()
            depth = 1
            i = start
            while i < len(src) and depth > 0:
                if src[i] == '{':
                    depth += 1
                elif src[i] == '}':
                    depth -= 1
                i += 1
            block = src[start:i]
            tm = re.search(r"type:\s*'([^']+)'", block)
            cm = re.search(r"category:\s*'([^']+)'", block)
            t = tm.group(1) if tm else None
            c = cm.group(1) if cm else None
            line_no = src[:m.start()].count('\n') + 1
            if t and t not in valid_types:
                issues.append(f'{os.path.relpath(p, root)}:{line_no} type={t!r} INVALID')
            if c and c not in valid_cats:
                issues.append(f'{os.path.relpath(p, root)}:{line_no} category={c!r} INVALID')
            if not t:
                issues.append(f'{os.path.relpath(p, root)}:{line_no} type MISSING')
print('ISSUES:' if issues else 'ALL VALID')
for i in issues:
    print(' -', i)
