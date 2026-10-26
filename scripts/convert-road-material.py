"""Convert reviewed CC BY 4.0 Bistro source pixels, without upscaling or AI art."""
from pathlib import Path
from PIL import Image, ImageFilter
root=Path('.asset-cache/bistro/files/Textures')
out=Path('.asset-cache/next');out.mkdir(parents=True,exist_ok=True)
for name,base,normal in [
 ('asphalt','Nature/Pavement_Ground_Wet_BaseColor.dds','Nature/Pavement_Ground_Wet_Normal.png'),
 ('pavement','Ground/Pavement_Curbstones_BaseColor.dds','Ground/Pavement_Curbstones_Normal.png')]:
 color=Image.open(root/base).convert('RGB')
 color.save(out/(name+'-color.png'))
 Image.open(root/normal).convert('RGB').save(out/(name+'-normal.png'))
 # Original source specifies scalar roughness .73. This additional low-amplitude
 # grain variance is authored by NEXUS, NOT a claimed captured roughness scan.
 color.convert('L').filter(ImageFilter.GaussianBlur(.5)).point(
  lambda x: min(218,max(175,186+(x-100)*.09))
 ).save(out/(name+'-roughness.png'))
 print(name,color.size)
