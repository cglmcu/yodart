# #coding:utf-8
# import os, sys

# ----------------------------------
#coding:utf-8
import os, sys

env_dist = os.environ
workspace = sys.argv[1]
config_path = os.path.join(workspace, 'test/testsets.txt')
with open(config_path, 'r') as f:
  for i in f.readlines():
    i = i.strip()
    if i.find("#") == -1:
      print i
