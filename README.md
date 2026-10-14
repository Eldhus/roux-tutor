# roux tutor

Learn [roux](https://github.com/Eldhus/roux), a Roc platform for web apps, by changing the app that
teaches it.

![The tutor's first page](docs/tutor.png)

On Linux 6.7 or later, on an x86-64-v3 CPU (AVX2: Intel Haswell, AMD Zen or newer):

```sh
git clone https://github.com/Eldhus/roux-tutor
cd roux-tutor
./roux dev main.roc
```

Open <http://localhost:8080>: two minutes on the first page, then a live speed page, then as deep
as you like. The first run downloads roux and the Roc compiler it uses into `.roux-tools/`
(checksums checked: a 76 MB download, 240 MB unpacked).

Datastar 1.0.2 (`static/`) is MIT-licensed, by Star Federation
([its license](static/datastar-LICENSE)). The tutor is MIT.

Part of [Eldhus](https://github.com/Eldhus).
