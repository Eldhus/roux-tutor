app [Context, program] { pf: platform "https://github.com/Eldhus/roux/releases/download/v0.2.2/54QkBtgQh6dMAUA6reFeFnkdBj2yiZLB7iKfSywDMZjQ.tar.zst" }

## roux-tutor: the tutorial is this app. Every page you read is a template
## in templates/, filled from the Roc below, and `./roux dev main.roc` puts
## your changes on the page as you save.

import pf.Server
import pf.Rocstache
import pf.Sqlite
import pf.Sse
import pf.File
import pf.Url
import db/Database
import db/Guestbook
import db/Likes
import templates/Hello
import templates/Start
import templates/Speed
import templates/Syntax
import templates/Routes
import templates/Book
import templates/Live
import templates/Ship
import templates/NotFound
import templates/Greeting
import templates/Menu
import templates/LikeCount

# ── Your turn ──────────────────────────────────────────────────────────────

## Who the greeting is for.
you = "friend"

## What templates/Hello.rocstache reads: `Hello.Ctx`, a type roux wrote in
## templates/Hello.roc. Add a field to the template, and roc asks for it here.
hello : Hello.Ctx
hello = { name: you }

## The menu (Go deeper: Templates).
dishes : List({ name : Str, price : U32 })
dishes = [
	{ name: "Roux", price: 120 },
	{ name: "Velouté", price: 240 },
	{ name: "Espagnole", price: 310 },
]

# ── The app ────────────────────────────────────────────────────────────────

Context : { db : Sqlite.Db }

program = { init!, respond! }

## Once, at start: the database (made from db/schema.sql the first time).
init! : () => Try({ config : Server.Config, context : Context }, [Exit(I64), DbErr(Sqlite.Err)])
init! = || {
	db = Sqlite.open!(Database.at("tutor.db"), { synchronous: Normal })?
	Ok({ config: { port: 8080, static_dir: "static" }, context: { db: db } })
}

Err : [NotFound, BadRequest(Str), DbErr(Sqlite.Err), FileErr(File.FileErr), SseErr(Sse.SseErr)]

## Every request. The pages made from data alone are `page`, pure; the ones
## that read a file or the database are here.
respond! : Server.Request, Context => Try(Server.Response(_), Err)
respond! = |request, { db }| {
	path = path_of(request.target)
	match (request.method, path) {
		("GET", "/templates") => templates!()
		("GET", "/guestbook") => book!(db, request)
		("POST", "/guestbook") => sign!(db, request)
		("GET", "/live") => live!(db, request)
		("POST", "/like") => like!(db, request)
		("GET", "/race/db") => {
			{ count } = Likes.count!(Sqlite.read(db, request))?
			Ok(Server.text("${count.to_str()} likes"))
		}
		("GET", "/race/patch") => {
			stream = Sse.start!(request, [])?
			Sse.send!(stream, Rocstache.patch!(LikeCount.template({ count: 7 })))?
			Sse.end!(stream)
		}
		("GET", _) =>
			match page(path) {
				Ok(response) => Ok(response)
				Err(NotFound) => Ok(not_found(path))
			}
		_ => Ok(not_found(path))
	}
}

## The pages made from data alone: no effects, so `roc test` can call it.
page : Str -> Try(Server.Response(_), [NotFound])
page = |path|
	match path.split_on("/") {
		["", ""] => Ok(Rocstache.html(Start.template({ frame: frame("/"), nav: nav("/"), hello })))
		["", "speed"] => Ok(Rocstache.html(Speed.template({ frame: frame("/speed"), nav: nav("/speed"), hello })))
		["", "routes"] => Ok(Rocstache.html(Routes.template({ frame: frame("/routes"), nav: nav("/routes") })))
		["", "ship"] => Ok(Rocstache.html(Ship.template({ frame: frame("/ship"), nav: nav("/ship") })))
		["", "race", "text"] => Ok(Server.text("Hello from Roc"))
		["", "race", "page"] => Ok(Rocstache.html(Menu.template({ dishes: dishes })))
		# Routes: a route of your own goes here.
		_ => Err(NotFound)
	}

## The Templates page shows the module roux wrote for templates/Hello.rocstache,
## read now, so it is as it is.
templates! : () => Try(Server.Response(_), Err)
templates! = || {
	generated = File.read_utf8!("templates/Hello.roc", 64 * 1024)?
	Ok(Rocstache.html(Syntax.template({ frame: frame("/templates"), nav: nav("/templates"), menu: { dishes: dishes }, generated })))
}

# ── The guestbook ──────────────────────────────────────────────────────────

book! : Sqlite.Db, Server.Request => Try(Server.Response(_), Err)
book! = |db, request| {
	signatures = Guestbook.recent!(Sqlite.read(db, request))?
	Ok(Rocstache.html(Book.template({ frame: frame("/guestbook"), nav: nav("/guestbook"), signatures })))
}

## A signature from the form: written, then back to the page (303), so a
## reload does not sign twice.
sign! : Sqlite.Db, Server.Request => Try(Server.Response(_), Err)
sign! = |db, request| {
	form = Str.from_utf8_lossy(Server.read_body!(request, 4096) ? |_| BadRequest("the form"))
	name = field(form, "name")?
	message = field(form, "message")?
	tx = Sqlite.write!(db, request)?
	Guestbook.sign!(tx, { name, message }) ? |_| BadRequest("a name of 1-40 characters, a message of at most 280")
	Sqlite.commit!(tx)?
	Ok({ status: 303, headers: [{ name: "Location", value: "/guestbook" }], body: Bytes([]) })
}

field : Str, Str -> Try(Str, [BadRequest(Str)])
field = |form, key|
	match Url.query_value("?${form}", key) {
		Ok(value) => Ok(value.trim())
		Err(_) => Err(BadRequest("the form has no ${key}"))
	}

# ── Live, with Datastar ────────────────────────────────────────────────────

live! : Sqlite.Db, Server.Request => Try(Server.Response(_), Err)
live! = |db, request| {
	{ count } = Likes.count!(Sqlite.read(db, request))?
	Ok(Rocstache.html(Live.template({ frame: frame("/live"), nav: nav("/live"), likes: { count: count } })))
}

## A click: the count goes up in the database, and the new count goes back
## as a Datastar patch, which replaces the element with its id.
like! : Sqlite.Db, Server.Request => Try(Server.Response(_), Err)
like! = |db, request| {
	tx = Sqlite.write!(db, request)?
	{ count } = Likes.like!(tx)?
	Sqlite.commit!(tx)?
	stream = Sse.start!(request, [])?
	Sse.send!(stream, Rocstache.patch!(LikeCount.template({ count: count })))?
	Sse.end!(stream)
}

# ── The frame every page shares ────────────────────────────────────────────

Lesson : { href : Str, name : Str }

## The two-minute path, then the rest.
start : List(Lesson)
start = [{ href: "/", name: "Start" }, { href: "/speed", name: "Speed" }]

deeper : List(Lesson)
deeper = [
	{ href: "/templates", name: "Templates" },
	{ href: "/routes", name: "Routes and tests" },
	{ href: "/guestbook", name: "Database" },
	{ href: "/live", name: "Live" },
	{ href: "/ship", name: "Ship" },
]

lessons : List(Lesson)
lessons = start.concat(deeper)

Marked : { href : Str, name : Str, number : Str, current : Bool }

## The page's title and the lessons, this one marked.
frame : Str -> { title : Str, start : List(Marked), deeper : List(Marked) }
frame = |here| {
	marked = lessons.map_with_index(|l, i| { href: l.href, name: l.name, number: (i + 1).to_str(), current: l.href == here })
	{
		title: (lessons.find_first(|l| l.href == here) ?? { href: here, name: "Not found" }).name,
		start: marked.take_first(start.len()),
		deeper: marked.drop_first(start.len()),
	}
}

## The lessons before and after this one (none at either end).
nav : Str -> { prev : List(Lesson), next : List(Lesson) }
nav = |here|
	match lessons.find_first_index(|l| l.href == here) {
		Ok(at) => {
			prev: if at == 0 [] else lessons.sublist({ start: at - 1, len: 1 }),
			next: lessons.sublist({ start: at + 1, len: 1 }),
		}
		Err(NotFound) => { prev: [], next: [] }
	}

not_found : Str -> Server.Response(_)
not_found = |path| {
	status: 404,
	headers: [{ name: "Content-Type", value: "text/html; charset=utf-8" }],
	body: Html(NotFound.template({ frame: frame(""), path })),
}

path_of : Str -> Str
path_of = |target|
	match target.split_first("?") {
		Ok({ before, .. }) => before
		Err(_) => target
	}

# ── Tests: `roc test main.roc` ─────────────────────────────────────────────

expect page("/nope") == Err(NotFound)

expect
	match page("/") {
		Ok({ status: 200, body: Html({ template: Start(start_page), .. }), .. }) => start_page.hello == hello
		_ => False
	}

expect nav("/").prev == [] and nav("/ship").next == []
