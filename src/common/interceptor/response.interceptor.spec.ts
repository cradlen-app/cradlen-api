import { ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';
import { paginated as paginatedPayload } from '../utils/pagination.utils';

function callHandler(value: unknown) {
  return { handle: () => of(value) };
}

describe('ResponseInterceptor', () => {
  let interceptor: ResponseInterceptor;

  beforeEach(() => {
    interceptor = new ResponseInterceptor();
  });

  it('wraps a plain object in { data, meta: {} }', (done) => {
    interceptor
      .intercept({} as ExecutionContext, callHandler({ id: '1' }))
      .subscribe((result) => {
        expect(result).toEqual({ data: { id: '1' }, meta: {} });
        done();
      });
  });

  it('passes undefined through without wrapping', (done) => {
    interceptor
      .intercept({} as ExecutionContext, callHandler(undefined))
      .subscribe((result) => {
        expect(result).toBeUndefined();
        done();
      });
  });

  it('restructures paginated payload into { data: items[], meta: pagination }', (done) => {
    const paginated = paginatedPayload([{ id: '1' }, { id: '2' }], {
      page: 1,
      limit: 10,
      total: 20,
    });

    interceptor
      .intercept({} as ExecutionContext, callHandler(paginated))
      .subscribe((result) => {
        expect(result).toEqual({
          data: [{ id: '1' }, { id: '2' }],
          meta: { page: 1, limit: 10, total: 20, totalPages: 2 },
        });
        done();
      });
  });

  it('passes explicit response envelopes through', (done) => {
    const response = {
      data: { id: '1' },
      message: 'Done',
    };

    interceptor
      .intercept({} as ExecutionContext, callHandler(response))
      .subscribe((result) => {
        expect(result).toEqual(response);
        done();
      });
  });

  it('wraps null in { data: null, meta: {} }', (done) => {
    interceptor
      .intercept({} as ExecutionContext, callHandler(null))
      .subscribe((result) => {
        expect(result).toEqual({ data: null, meta: {} });
        done();
      });
  });

  it('wraps a string in { data: string, meta: {} }', (done) => {
    interceptor
      .intercept({} as ExecutionContext, callHandler('hello'))
      .subscribe((result) => {
        expect(result).toEqual({ data: 'hello', meta: {} });
        done();
      });
  });

  it('wraps an array in { data: array, meta: {} } when not a paginated payload', (done) => {
    interceptor
      .intercept({} as ExecutionContext, callHandler([{ id: '1' }]))
      .subscribe((result) => {
        expect(result).toEqual({ data: [{ id: '1' }], meta: {} });
        done();
      });
  });
});
