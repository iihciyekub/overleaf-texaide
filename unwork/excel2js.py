import os
import pandas as pd
import json

fn = "json.xlsx"
# 读取xlsx
xlsx = pd.ExcelFile(fn)
# 读取sheet
sheet = xlsx.sheet_names
# 读取sheet的内容
dfl = []
for i in sheet:
    dfl.append(pd.read_excel(fn, sheet_name=i))
df = pd.concat(dfl)
df = df.dropna(how="all")
xlsx.close()


def fun(x, y):
    
    if isinstance(x, str):
        return y
    else:
        return [i for i in y.split("\n") if i != ""]


t = map(fun, df['tag'], df['macro'])
df['macro'] = list(t)

df = df.explode(['macro'])

def fun(x):
    if ": " in x:
        x = x.replace(": ", "：")
    try:
        return x.split("：")[1]
    except:
        return ""
df['info'] = df['macro'].apply(fun)
df[df['info']!=""]



def fun(x):
    try:
        return x.split("：")[0]
    except:
        return ""
df['macro'] = df['macro'].apply(fun)
df

def fun(x, y):
    try:
        # 判断是否等于字串类型
        if isinstance(x, str):
            return x
        else:
            return y
    except:
        return None


t = map(fun, df['tag'], df['macro'])
df['tag'] = list(t)


def fun(x, y):
    try:
        return x.replace("#macro", y)
    except:
        return None


t = map(fun, df['example'], df['macro'])
df['example'] = list(t)


def fun(x, y):
    try:
        return x.replace("#info", y)
    except:
        return None


t = map(fun, df['example'], df['info'])
df['example'] = list(t)


df = df .reset_index(drop=1)
# 在df的第一列中插入
df.insert(0, 'id', df.index)

df = df.drop(columns=[ 'info'])
print(df.shape)
t = df.to_json(orient="records", force_ascii=False)
t = f"window.tikzPGFjson ={t}"
with open("tikzPGF.json.js", "w", encoding="utf-8") as f:
    f.write(t)

