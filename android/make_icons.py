from PIL import Image
import os
src = r'D:\AIagent-lmq\DanLumeMobile\public\icons\app-512.png'
im = Image.open(src).convert('RGBA')
sizes = {'mdpi':48,'hdpi':72,'xhdpi':96,'xxhdpi':144,'xxxhdpi':192}
base = r'D:\AIagent-lmq\DanLumeMobile\android\res'
for name, size in sizes.items():
    d = os.path.join(base, 'mipmap-' + name)
    os.makedirs(d, exist_ok=True)
    im.resize((size, size), Image.LANCZOS).save(os.path.join(d, 'ic_launcher.png'))
print('icons ok')