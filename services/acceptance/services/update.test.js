/*
 * This suite of acceptance tests corresponds to JEP-307 and ensures that the
 * Update service is behaving as expected
 */

const fs   = require('fs');

const assert   = require('assert');
const request  = require('request-promise');
const h        = require('../helpers');

/*
 * Necessary for testing events sent to a socket.io client when updates are
 * created
 */
const feathers = require('@feathersjs/feathers');
const socketio = require('@feathersjs/socketio-client');
const io       = require('socket.io-client');

describe('Update service acceptance tests', () => {
  beforeAll((done) => {
    this.ingest = JSON.parse(fs.readFileSync('./ingest.json'));
    this.settings = JSON.parse(fs.readFileSync(`./config/${process.env.NODE_ENV}.json`));
    h.startApp(done);
  });
  afterAll(done => h.stopApp(done));

  beforeEach(async () => {
    let { token, uuid } = await h.registerAndAuthenticate();
    this.token = token;
    this.uuid = uuid;
  });

  describe('POST /update', () => {
    it('should treat an empty `create` as invalid', () => {
      return request({
        url: h.getUrl('/update'),
        method: 'POST',
        json: true,
        resolveWithFullResponse: true,
        headers: { 'Authorization': this.settings.internalAPI.secret },
        body: {}
      })
        .then(res => assert.fail(res.body))
        .catch(err => {
          expect(err.statusCode).toEqual(400);
        });
    });

    describe('duplicative requests', () => {
      let commit = Date.now().toString();

      beforeEach(() => {
        return request({
          url: h.getUrl('/update'),
          method: 'POST',
          headers: { 'Authorization': this.settings.internalAPI.secret },
          json: true,
          resolveWithFullResponse: true,
          body: {
            commit: commit,
            manifest: this.ingest,
          },
        });
      });

      it('it should politely decline for a redundant commit', async () => {
        try {
          const response = await request({
            url: h.getUrl('/update'),
            method: 'POST',
            headers: { 'Authorization': this.settings.internalAPI.secret },
            json: true,
            resolveWithFullResponse: true,
            body: {
              commit: commit,
              manifest: this.ingest,
            },
          });
          expect(response).toBeFalsy();
        } catch (err) {
          if (err.statusCode != 304) {
            throw err;
          }
        }
      });
    });

    it('should treat a valid "ingest JSON" as valid', () => {
      return request({
        url: h.getUrl('/update'),
        method: 'POST',
        headers: { 'Authorization': this.settings.internalAPI.secret },
        json: true,
        resolveWithFullResponse: true,
        body: {
          commit: Date.now().toString(),
          manifest: this.ingest,
        },
      })
        .then(res => {
          expect(res.statusCode).toEqual(201);
          expect(res.body.id).toBeGreaterThan(0);
        })
        .catch((err) => assert.fail(err));
    });

    describe('with a socket.io client connected', () => {
      beforeEach(() => {
        this.socket = io(h.getUrl(''));
        this.client = feathers();
        this.client.configure(socketio(this.socket));
      });

      afterEach(() => {
        this.socket.close();
      });

      it('should emit an event when an update is created', async () => {
        let found = false;

        this.client.service('update').on('created', (message) => {
          expect(message).toBeTruthy();
          found = true;
        });

        const response = await request({
          url: h.getUrl('/update'),
          method: 'POST',
          headers: { 'Authorization': this.settings.internalAPI.secret },
          json: true,
          resolveWithFullResponse: true,
          body: {
            commit: Date.now().toString(),
            manifest: this.ingest,
          },
        });

        expect(response.statusCode).toEqual(201);
        expect(found).toBeTruthy();
        expect.assertions(3);
      });
    });
  });

  describe('PATCHing an existing update level', () => {
    beforeEach(() => {
      this.commit = `patch-${Date.now().toString()}`;
      this.ingest = JSON.parse(fs.readFileSync('./ingest.json'));

      return request({
        url: h.getUrl('/update'),
        method: 'POST',
        headers: { 'Authorization': this.settings.internalAPI.secret },
        json: true,
        body: {
          commit: this.commit,
          manifest: this.ingest,
        },
      });
    });

    it('should allow tainting', async () => {
      const response = await request({
        url: h.getUrl('/update'),
        method: 'PATCH',
        headers: { 'Authorization': this.settings.internalAPI.secret },
        json: true,
        resolveWithFullResponse: true,
        body: {
          commit: this.commit,
          channel: 'general',
          tainted: true,
        }
      });
      expect(response.statusCode).toEqual(200);
    });
  });
});
